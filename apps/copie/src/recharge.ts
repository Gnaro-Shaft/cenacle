/**
 * The reload itself (ADR-0044, point 7), as the owner: the checks that can
 * be said clearly before anything stops (the copy's columns exist; the
 * tables are empty, or replaced), then ONE transaction run by the
 * container's psql through its own network address — the same checks again
 * inside it, the tables emptied when replaced, the judged script — so that
 * any error leaves the tables as they were. psql's errors are never shown:
 * a COPY error quotes its row. Only this module's own markers are read.
 */
import { spawn } from "node:child_process";
import { COPIE_TABLES, OWNER_ROLE } from "@cenacle/journal";
import type { Sql } from "postgres";
import type { CopyContent } from "./archive.ts";
import { type Container, CopieError, childEnv } from "./export.ts";

/** The tables that point at securite_constats, ON DELETE CASCADE, and are not copied. */
export const DEPENDENTS = ["securite_raisons", "serveur_actions"] as const;

/** How the tables are found: empty (the default), replaced, or a trial's (any state). */
export type Mode = "vides" | "remplacer" | "essai";

const quoted = (names: readonly string[]) => names.map((n) => `public.${n}`).join(", ");

/** The copy's columns the base lacks, as "table.column": a base behind its migrations. */
export async function missingColumns(sql: Sql, content: CopyContent): Promise<string[]> {
  const rows = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name = any(${[...content.columns.keys()]})`;
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return [...content.columns].flatMap(([table, cols]) =>
    cols.map((c) => `${table}.${c}`).filter((name) => !have.has(name)),
  );
}

/** Rows per table: the four, and the tables that depend on securite_constats. */
export async function rowCounts(sql: Sql): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of [...COPIE_TABLES, ...DEPENDENTS]) {
    const [row] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from public.${table}`,
    );
    counts.set(table, row?.n ?? 0);
  }
  return counts;
}

/** Refuses, before anything stops, what the transaction would refuse anyway — said plainly. */
export function refuseState(counts: ReadonlyMap<string, number>, mode: Mode): void {
  if (mode === "vides") {
    const full = COPIE_TABLES.filter((t) => (counts.get(t) ?? 0) > 0);
    if (full.length > 0) {
      const said = full.map((t) => `${t} (${counts.get(t)} lignes)`).join(", ");
      throw new CopieError(
        `des tables ne sont pas vides : ${said} — --remplacer les vide et les recharge`,
      );
    }
  }
  if (mode === "remplacer") {
    const used = DEPENDENTS.filter((t) => (counts.get(t) ?? 0) > 0);
    if (used.length > 0) {
      const said = used.map((t) => `${t} (${counts.get(t)} lignes)`).join(", ");
      throw new CopieError(
        `vider securite_constats effacerait aussi ${said}, qui ne sont pas copiées : rien n'est remplacé`,
      );
    }
  }
}

const MARK = "cenacle-restaurer";

/** The whole transaction's text: the guards, the emptying, then the judged script. */
export function reloadText(script: string, mode: Mode): string {
  const lines = [
    `LOCK TABLE ${quoted([...COPIE_TABLES, ...DEPENDENTS])} IN ACCESS EXCLUSIVE MODE;`,
  ];
  const guard = (tables: readonly string[], why: string) =>
    tables.map(
      (t) =>
        `DO $g$ BEGIN IF EXISTS (SELECT 1 FROM public.${t}) THEN RAISE EXCEPTION '${MARK}:${why}:${t}'; END IF; END $g$;`,
    );
  if (mode === "vides") lines.push(...guard(COPIE_TABLES, "non-vide"));
  if (mode === "remplacer") lines.push(...guard(DEPENDENTS, "dependante"));
  // Emptied when replaced, or in a trial: securite_constats' dependents go with
  // it (ON DELETE CASCADE) — refused above when replacing the real base.
  if (mode !== "vides") lines.push(...COPIE_TABLES.map((t) => `DELETE FROM public.${t};`));
  return `${lines.join("\n")}\n${script}`;
}

/** What psql's error said, if it is one of ours; else nothing of it is kept. */
export function markerOf(stderr: string): string | null {
  // psql's own ERROR line only: a COPY error's CONTEXT quotes a row, which could carry a marker.
  const line = `^psql:[^\\n]*: ERROR: {2}${MARK}:(non-vide|dependante):([a-z_]+)$`;
  const found = new RegExp(line, "m").exec(stderr);
  return found === null ? null : `${found[1]}:${found[2]}`;
}

export interface ReloadTarget {
  readonly docker: string;
  readonly container: Container;
  readonly database: string;
  readonly ownerPassword: string;
}

/** Runs the text in one transaction; throws, saying nothing of the rows, when it fails. */
export function reload(target: ReloadTarget, text: string): Promise<void> {
  const args = [
    "exec",
    "-i",
    "-e",
    "PGPASSWORD",
    target.container.name,
    "psql",
    "-X",
    "-q",
    "-h",
    target.container.address,
    "-U",
    OWNER_ROLE,
    "-d",
    target.database,
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f",
    "-",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(target.docker, args, {
      env: { ...childEnv(), PGPASSWORD: target.ownerPassword },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 65_536) stderr += chunk.toString("utf8");
    });
    const fail = (why: string) =>
      reject(new CopieError(`${why} : la transaction est annulée, aucune table n'a changé`));
    child.on("error", () => fail("psql n'a pas pu être lancé"));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const marker = markerOf(stderr);
      if (marker !== null) fail(`${marker.slice(marker.indexOf(":") + 1)} n'est plus vide`);
      else fail(`le rechargement a échoué (code ${code})`);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}

/** One table's fingerprint: its rows counted and summed, never shown. */
export interface Fingerprint {
  readonly rows: number;
  readonly sum: string;
  readonly sequence: string;
}

export async function fingerprints(sql: Sql): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  for (const table of COPIE_TABLES) {
    const [row] = await sql.unsafe<{ rows: number; sum: string }[]>(
      `select count(*)::int as rows,
              md5(coalesce(string_agg(t::text, E'\\n' order by t.id), '')) as sum
       from public.${table} t`,
    );
    const [seq] = await sql.unsafe<{ v: string }[]>(
      `select last_value::text || ':' || is_called::text as v from public.${table}_id_seq`,
    );
    out.set(table, { rows: row?.rows ?? 0, sum: row?.sum ?? "", sequence: seq?.v ?? "" });
  }
  return out;
}
