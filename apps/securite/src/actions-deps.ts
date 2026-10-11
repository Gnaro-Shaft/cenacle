/**
 * What the security agent's actions need, built for one round (J6c, J6d):
 * the programs (git, npm, gh — fixed paths), securite.toml read strictly, the
 * trust record counted from the journal over its retention (180 days), each
 * delegation's state, and the buttons sent with their single-use tokens.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createSecuriteDecisions,
  type Journal,
  latestEventAt,
  type SecuriteStore,
} from "@cenacle/journal";
import {
  DELEGABLE_LABEL,
  delegationState,
  localDay,
  parseDelegations,
  type TrustLine,
} from "@cenacle/securite";
import type { TelegramApi } from "@cenacle/telegram/api";
import type { Sql } from "postgres";
import type { ActionDeps, DelegationInfo } from "./actions.ts";
import { firstExisting, runProgram } from "./checks.ts";
import { prepareFix } from "./fix.ts";
import { closeOnRequest, mergeOnRequest, viewPr } from "./merge.ts";

const RECORD_DAYS = 180;

export async function delegationInfos(
  root: string,
  sql: Sql,
  store: Pick<SecuriteStore, "actionCounts">,
  now: Date,
): Promise<DelegationInfo[]> {
  const delegations = parseDelegations(
    readFileSync(join(root, "securite.toml"), "utf8"),
    localDay(now),
  );
  const since = new Date(now.getTime() - RECORD_DAYS * 24 * 3_600_000);
  return Promise.all(
    delegations.map(async (d) => {
      const trust = await store.actionCounts(d.action, since);
      const suspended = await latestEventAt(sql, "securite", "securite.delegation", {
        delegable: d.action,
        state: "suspendue",
      });
      const proposedAt = await latestEventAt(sql, "securite", "securite.delegation", {
        delegable: d.action,
        state: "proposee",
      });
      return {
        action: d.action,
        state: delegationState(d, trust, suspended === null ? null : localDay(suspended)),
        seuil: d.seuil,
        mergedClean: trust.mergedClean,
        proposedAt,
      };
    }),
  );
}

export async function actionDeps(options: {
  readonly root: string;
  readonly sql: Sql;
  readonly store: SecuriteStore;
  readonly journal: Journal;
  readonly telegram: Pick<TelegramApi, "sendMessage" | "sendWithButtons">;
  readonly chatId: number;
  readonly now: () => Date;
}): Promise<ActionDeps> {
  const { root, sql, store, journal, telegram, chatId } = options;
  const gh = firstExisting("/opt/homebrew/bin/gh", "/usr/local/bin/gh");
  const ops = { run: runProgram(120_000), root, gh };
  return {
    store,
    prepare: (req) =>
      prepareFix(req, {
        run: runProgram(300_000),
        root,
        tmpRoot: tmpdir(),
        git: firstExisting("/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"),
        npm: join(dirname(process.execPath), "npm"),
        gh,
      }),
    view: (url) => viewPr(url, ops),
    merge: (url, sha) => mergeOnRequest(url, sha, ops),
    close: (url) => closeOnRequest(url, ops),
    tokens: (ids) => createSecuriteDecisions(sql).tokens(ids),
    send: (text) => telegram.sendMessage(chatId, text),
    sendButtons: async (text, rows) => {
      await telegram.sendWithButtons(
        chatId,
        text,
        rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      );
    },
    journal,
    delegations: await delegationInfos(root, sql, store, options.now()),
    now: options.now,
  };
}

/** The trust record for the Monday review: each delegation, its counts and state. */
export async function trustLines(
  root: string,
  sql: Sql,
  store: Pick<SecuriteStore, "actionCounts">,
  now: Date,
): Promise<TrustLine[]> {
  const since = new Date(now.getTime() - RECORD_DAYS * 24 * 3_600_000);
  const infos = await delegationInfos(root, sql, store, now);
  return Promise.all(
    infos.map(async (d) => ({
      label: DELEGABLE_LABEL[d.action],
      state: d.state,
      seuil: d.seuil,
      ...(await store.actionCounts(d.action, since)),
    })),
  );
}
