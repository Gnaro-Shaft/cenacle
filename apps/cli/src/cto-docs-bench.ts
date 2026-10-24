/**
 * Runs the bench of the CTO's documentation (ADR-0033, § 6).
 * Usage: npm run cto:banc-docs [-- Q01,Q05] [-- --passages 2]
 *
 * Each question is asked with the former context (all the documentation, in
 * the fixed order, 300 000 characters) and with the new one (core, map and the
 * question's documents), alternately: pass 1 old then new, pass 2 new then
 * old. Same model, same temperature, the real circuit (tools, checks).
 * Counted: points given (criteria fixed in cto-docs-bench/questions.ts),
 * references not found in the repository, tool calls, seconds.
 *
 * Long — about a minute per answer — and Iris waits for the model meanwhile:
 * run it when the model is free. The answers go to a temporary folder, for
 * reading; nothing is kept but the journal's usual counts.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import {
  admitDocumentation,
  askCto,
  ctoModels,
  type ProjectContext,
  selectContext,
} from "@cenacle/cto";
import { connectOrQuit, createJournal, type Journal } from "@cenacle/journal";
import { QUESTIONS, score } from "./cto-docs-bench/questions.ts";

refuseForeignSecrets("Le banc de documentation du CTO", []);
/** The budget the former context had when it was replaced (2026-10-23). */
const FORMER_BUDGET = 300_000;
const ROOT = join(import.meta.dirname, "..", "..", "..");

const args = process.argv.slice(2);
const at = args.indexOf("--passages");
const passes = at === -1 ? 2 : Number(args[at + 1]);
if (!Number.isInteger(passes) || passes < 1 || passes > 4) {
  console.error("--passages : un entier de 1 à 4.");
  process.exit(2);
}
const only = args.find((a) => /^Q\d/.test(a))?.split(",");
const questions = QUESTIONS.filter((q) => only === undefined || only.includes(q.id));

type Mode = "ancien" | "nouveau";
const admitted = admitDocumentation(ROOT);
const contextFor = (mode: Mode, question: string): ProjectContext =>
  mode === "ancien"
    ? selectContext(admitted, { kind: "all" }, FORMER_BUDGET)
    : selectContext(admitted, { kind: "question", text: question });

interface Row {
  readonly id: string;
  readonly mode: Mode;
  readonly pass: number;
  readonly points: number;
  readonly of: number;
  readonly notFound: number;
  readonly tools: number;
  readonly seconds: number;
  readonly failed: boolean;
}

/** The journal, with the count of references not found taken on the way. */
function counting(journal: Journal): { journal: Journal; notFound: () => number } {
  let last = 0;
  return {
    journal: {
      read: (options) => journal.read(options),
      append: (event) => {
        if (event.type === "cto.verified") {
          const n = (event.payload as { notFound?: unknown }).notFound;
          last = typeof n === "number" ? n : 0;
        }
        return journal.append(event);
      },
    },
    notFound: () => last,
  };
}

const out = mkdtempSync(join(tmpdir(), "cto-banc-docs-"));
const sql = connectOrQuit();
const watched = counting(createJournal(sql));
const local = ctoModels();
const rows: Row[] = [];
try {
  for (let pass = 1; pass <= passes; pass++) {
    const order: Mode[] = pass % 2 === 1 ? ["ancien", "nouveau"] : ["nouveau", "ancien"];
    for (const q of questions) {
      for (const mode of order) {
        const started = Date.now();
        let tools = 0;
        const context = contextFor(mode, q.question);
        try {
          const reply = await askCto(
            q.question,
            {
              root: ROOT,
              journal: watched.journal,
              local,
              onProgress: (p) => {
                if (p.kind === "tool") tools++;
              },
            },
            { context },
          );
          const s = score(q, reply.text);
          const row: Row = {
            id: q.id,
            mode,
            pass,
            points: s.points,
            of: s.of,
            notFound: watched.notFound(),
            tools,
            seconds: Math.round((Date.now() - started) / 1000),
            failed: false,
          };
          rows.push(row);
          writeFileSync(
            join(out, `${q.id}-${mode}-${pass}.txt`),
            `${q.question}\n\n${reply.text}\n\n${reply.summary}\n`,
          );
          console.log(
            `${s.right ? "✔" : "✘"} ${q.id} ${mode} #${pass} — ${s.points}/${s.of} points, ${row.notFound} introuvable(s), ${tools} outil(s), ${row.seconds} s, ${context.chars} car.`,
          );
        } catch (error) {
          rows.push({
            id: q.id,
            mode,
            pass,
            points: 0,
            of: q.points.length,
            notFound: 0,
            tools,
            seconds: Math.round((Date.now() - started) / 1000),
            failed: true,
          });
          console.log(`✘ ${q.id} ${mode} #${pass} — échec (${errorText(error)})`);
        }
      }
    }
  }
  console.log("\nContexte · passage · points · justes · introuvables · outils · temps médian");
  for (const mode of ["ancien", "nouveau"] as const) {
    for (let pass = 1; pass <= passes; pass++) {
      const these = rows.filter((r) => r.mode === mode && r.pass === pass);
      const sum = (f: (r: Row) => number) => these.reduce((n, r) => n + f(r), 0);
      const seconds = these.map((r) => r.seconds).sort((a, b) => a - b);
      const failed = these.filter((r) => r.failed).length;
      console.log(
        `${mode} · #${pass} · ${sum((r) => r.points)}/${sum((r) => r.of)} · ${these.filter((r) => r.points === r.of).length}/${these.length} · ${sum((r) => r.notFound)} · ${sum((r) => r.tools)} · ${seconds[Math.floor(seconds.length / 2)] ?? 0} s${failed > 0 ? ` · ${failed} échec(s)` : ""}`,
      );
    }
  }
  writeFileSync(join(out, "resultats.json"), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nRéponses et résultats dans ${out}`);
  console.log(
    "Critère (ADR-0033) : le nouveau contexte couvre au moins autant de points que l'ancien, aux écarts entre passages près, sans référence introuvable de plus.",
  );
} finally {
  await sql.end();
}
