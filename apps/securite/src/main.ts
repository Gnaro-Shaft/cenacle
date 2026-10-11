/**
 * The security agent (J6a, ADR-0025). Usage:
 *   npm run securite                              one round: checks, findings, message
 *   npm run securite -- constats                  what is open, accepted
 *   npm run securite -- accepter <n°> <raison>    I take the risk of an open finding
 * It checks, follows and proposes; it never fixes anything itself (charter,
 * rule 1). It holds the Telegram token and nothing else.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import {
  askAgent,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import { errorText, heartbeatFromEnv, refuseForeignSecrets, UsageError } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createSecuriteDecisions,
  createSecuriteStore,
  holdSingleInstance,
  latestEventAt,
} from "@cenacle/journal";
import {
  buildCommentPrompt,
  COMMENT_SYSTEM_PROMPT,
  cleanComment,
  keyboard,
  LOCAL_CHECKS,
  parseServerSwitch,
  preparedFix,
  SERVER_CATALOGUE,
  SEVERITY_LABEL,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { runActions } from "./actions.ts";
import { actionDeps, trustLines } from "./actions-deps.ts";
import { bulletinResults, loadSoftware } from "./bulletins-check.ts";
import {
  loadProjects,
  projectSpecs,
  projectsResult,
  runChecks,
  runProgram,
  specs,
} from "./checks.ts";
import { runRound } from "./round.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const readIfExists = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
const USAGE = "usage : npm run securite [-- constats | accepter <n°> <raison>]";
const [command, ...rest] = process.argv.slice(2);

refuseForeignSecrets("L'agent sécurité", ["telegram", "sentinel"]);
const sql = connectOrQuit();
const store = createSecuriteStore(sql);

async function round(): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
  }
  const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
  const journal = createJournal(sql);
  // The sentinel hears one beat per round that went to its end (J6e1).
  const sentinel = heartbeatFromEnv("securite");
  if (sentinel === null) {
    console.log(
      "ℹ Sentinelle non configurée (CENACLE_SENTINEL_URL absent) : aucun battement envoyé.",
    );
  }
  const local = createLocalModels({
    ...localModelConfigFromEnv(),
    contextWindow: 8_192,
    maxTokens: 400,
  });
  // Darwin 25 is macOS 26: what tells a point release from a new major version.
  const macMajor = Number(release().split(".")[0]) + 1;
  const outcome = await runRound({
    checks: async (network) => {
      // My other projects (J6e2): the list read at each round, their audits once an hour.
      const projects = loadProjects(ROOT);
      const nodeDir = dirname(process.execPath);
      const list = [
        ...specs(ROOT, nodeDir, macMajor).filter((s) => network || LOCAL_CHECKS.includes(s.check)),
        ...(network && projects !== null ? projectSpecs(projects, nodeDir) : []),
      ];
      const [checked, bulletins] = await Promise.all([
        runChecks(list, runProgram()),
        // The CERT-FR's bulletins (J6e3), with the network checks.
        network
          ? bulletinResults(loadSoftware(ROOT), { fetch, now: () => Date.now() })
          : Promise.resolve([]),
      ]);
      return [...checked, ...bulletins, projectsResult(projects)];
    },
    store,
    comment: async (f) => {
      try {
        const answer = await askAgent({
          question: buildCommentPrompt(f, randomBytes(6).toString("hex")),
          agent: "cto",
          systemPrompt: COMMENT_SYSTEM_PROMPT,
          // Package names and settings of my Mac: nobody's data.
          dataClass: "no_personal_data",
          journal,
          local,
          timeoutMs: 120_000,
        });
        return cleanComment(answer.text);
      } catch (error) {
        if (error instanceof ModelUnavailableError) return null;
        throw error;
      }
    },
    // Buttons under the findings still to fix, each with its single-use token (J6b).
    send: async (text, buttonsFor) => {
      const tokens = await createSecuriteDecisions(sql).tokens(buttonsFor);
      const findings = new Map((await store.active()).map((f) => [f.id, f]));
      // 🔁 under a server finding when the switch is on (J6f1b); the operator checks the rest.
      const servers = parseServerSwitch(readIfExists(join(ROOT, "securite.toml")));
      const rows = keyboard(
        [...tokens].map(([id, token]) => {
          const f = findings.get(id);
          return {
            id,
            token,
            fixable: f !== undefined && preparedFix(f, f.params) !== null,
            server: servers && f?.type === SERVER_CATALOGUE.services.finding,
          };
        }),
      );
      if (rows.length === 0) return telegram.sendMessage(chatId, text);
      await telegram.sendWithButtons(
        chatId,
        text,
        rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      );
    },
    journal,
    now: () => new Date(),
    lastNetwork: () => latestEventAt(sql, "securite", "securite.ran", { network: true }),
    lastReport: () => latestEventAt(sql, "securite", "securite.rapport"),
    lastWeekly: () => latestEventAt(sql, "securite", "securite.bilan"),
    // 🔧 The fixes, their pull requests, the delegations (J6c, J6d): never a merge without my button.
    trust: () => trustLines(ROOT, sql, store, new Date()),
    alive: async () => {
      if (sentinel === null) return false;
      const ok = await sentinel.beat();
      if (!ok)
        console.error(
          "⚠ La sentinelle n'a pas pris le battement (injoignable, ou pas encore à jour) : la ronde, elle, a eu lieu.",
        );
      return ok;
    },
    actions: async () =>
      runActions(
        await actionDeps({
          root: ROOT,
          sql,
          store,
          journal,
          telegram,
          chatId,
          now: () => new Date(),
        }),
      ),
  });
  console.log(
    `✔ Ronde : ${outcome.checks} contrôle(s)${outcome.network ? " (dont réseau)" : ""}, ${outcome.impossible} impossible(s) ; ${outcome.urgent} urgent(s) dit(s)${outcome.report ? ", rapport du matin envoyé" : ""} ; ${outcome.open} ouvert(s)${outcome.weekly ? " ; bilan de la semaine envoyé" : ""}`,
  );
}

async function list(): Promise<void> {
  const line = (f: {
    id: number;
    severity: keyof typeof SEVERITY_LABEL;
    title: string;
    status: string;
  }) =>
    `  n°${f.id} · ${SEVERITY_LABEL[f.severity]} · ${f.title}${f.status === "pris_en_charge" ? " (pris en charge)" : ""}`;
  const open = await store.open();
  const accepted = await store.accepted();
  console.log(
    open.length === 0 ? "Aucun constat ouvert." : `Ouverts :\n${open.map(line).join("\n")}`,
  );
  if (accepted.length > 0) {
    console.log(`Acceptés :\n${accepted.map((f) => `${line(f)} — ${f.reason ?? ""}`).join("\n")}`);
  }
}

async function accept(): Promise<void> {
  const [raw, ...words] = rest;
  const id = Number(raw);
  const reason = words.join(" ").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || reason.length < 3) throw new UsageError(USAGE);
  if (!(await store.accept(id, reason, new Date()))) {
    throw new UsageError(`aucun constat ouvert n°${id} (npm run securite -- constats)`);
  }
  console.log(
    `✔ Constat n°${id} accepté : il se tait jusqu'à une nouvelle occurrence, et sera redemandé dans 90 jours.`,
  );
}

let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
const lockSql = command === undefined ? connectOrQuit("lock") : null;
try {
  if (lockSql !== null) {
    // One round at a time: a second one sends nothing (75).
    instance = await holdSingleInstance(lockSql, "securite");
    if (instance === null) {
      console.error("🛑 Un autre passage de l'agent sécurité tourne déjà : celui-ci ne fait rien.");
      process.exitCode = 75;
    } else await round();
  } else if (command === "constats" && rest.length === 0) await list();
  else if (command === "accepter") await accept();
  else throw new UsageError(USAGE);
} catch (error) {
  console.error(`🛑 ${errorText(error, [UsageError])}`);
  process.exitCode = 1;
} finally {
  await instance?.release();
  await Promise.all([lockSql?.end(), sql.end()]);
}
