// ADR-0044, point 10, on a real database: a base of its own, migrated, with
// a row in a copied table and one in the journal; pg_dump in the container as
// cenacle_copie, through age, for a throwaway key. What is checked: the file
// is age's, the plain rows are not in it; decrypted, it holds the four
// tables' data and their sequences, and nothing else (the list read in the
// archive itself); a wrong password, a failing age or a recipient age
// refuses leave no file.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COPIE_PASSWORD_VAR, EXECUTOR_PASSWORD_VAR } from "@cenacle/journal";
import { loadEnv, migrate, ownerUrlFromEnv, requireEnv } from "@cenacle/journal/test-db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Container,
  CopieError,
  dumpEncrypted,
  findContainer,
  findTool,
  TOOLS,
} from "./export.ts";

const DB = "cenacle_copie_essai";
const DIR = mkdtempSync(join(tmpdir(), "cenacle-copie-essai-"));
const MARK = `marque-rappel-${Date.now()}`;
const JOURNAL_MARK = `marque-journal-${Date.now()}`;
const docker = findTool(TOOLS.docker) ?? "docker";
const age = findTool(TOOLS.age) ?? "age";
const keygen = age.replace(/age$/, "age-keygen");
let container: Container = { name: "", address: "" };
let recipient = "";
const identity = join(DIR, "cle");

function owner(database: string) {
  return postgres(ownerUrlFromEnv(database), { max: 1, onnotice: () => {} });
}

beforeAll(async () => {
  loadEnv();
  const admin = owner("postgres");
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB}`);
  } finally {
    await admin.end();
  }
  await migrate({
    ownerUrl: ownerUrlFromEnv(DB),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
    executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
    copiePassword: requireEnv(COPIE_PASSWORD_VAR),
  });
  const sql = owner(DB);
  try {
    await sql`insert into rappels (texte, echeance) values (${MARK}, now() + interval '1 day')`;
    await sql`insert into events (agent, type, payload)
              values ('essai', 'heartbeat', ${sql.json({ m: JOURNAL_MARK })})`;
  } finally {
    await sql.end();
  }
  execFileSync(keygen, ["-o", identity], { stdio: "ignore" });
  recipient = execFileSync(keygen, ["-y", identity], { encoding: "utf8" }).trim();
  container = findContainer(docker, process.env.CENACLE_DB_PORT ?? "55432") ?? container;
}, 120_000);

afterAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  const admin = owner("postgres");
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

const options = (out: string, change: Record<string, unknown> = {}) => ({
  docker,
  age,
  container,
  database: DB,
  password: requireEnv(COPIE_PASSWORD_VAR),
  recipient,
  out,
  ...change,
});

/** The decrypted archive through the container's pg_restore: its table of contents, or its SQL. */
function restored(file: string, args: string[]): string {
  const plain = execFileSync(age, ["--decrypt", "--identity", identity, file]);
  return execFileSync(docker, ["exec", "-i", container.name, "pg_restore", ...args], {
    input: plain,
    encoding: "utf8",
  });
}

let draws = 0;
const name = () => join(DIR, `cenacle-2026-11-18-${String(++draws).padStart(16, "0")}.age`);

/** A stand-in for age, writing its own output (argument 5, after --output). */
function fakeAge(name: string, body: string): string {
  const path = join(DIR, name);
  writeFileSync(path, `#!/bin/sh\nout="$5"\n${body}\n`);
  chmodSync(path, 0o700);
  return path;
}

describe("the copy of a real base", () => {
  it("finds one database container, and its address on its network", () => {
    expect(container.name).not.toBe("");
    expect(container.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(container.address.startsWith("127.")).toBe(false);
  });

  it("is age's, holds no plain row, and opens with the key alone", async () => {
    const out = name();
    const size = await dumpEncrypted(options(out));
    const raw = readFileSync(out);
    expect(size).toBe(raw.length);
    expect(raw.subarray(0, 22).toString("latin1")).toBe("age-encryption.org/v1\n");
    expect(raw.includes(MARK)).toBe(false);
    expect(raw.includes("rappels")).toBe(false);

    const entries = restored(out, ["--list"])
      .split("\n")
      .filter((l) => /^\d+;/.test(l))
      .map((l) => /(TABLE DATA|SEQUENCE SET) public (\S+)/.exec(l)?.slice(1, 3).join(" ") ?? l)
      .sort();
    expect(entries).toEqual([
      "SEQUENCE SET prospection_cartes_id_seq",
      "SEQUENCE SET rappels_id_seq",
      "SEQUENCE SET securite_constats_id_seq",
      "SEQUENCE SET veille_articles_id_seq",
      "TABLE DATA prospection_cartes",
      "TABLE DATA rappels",
      "TABLE DATA securite_constats",
      "TABLE DATA veille_articles",
    ]);
    const text = restored(out, ["--data-only", "--file=-"]);
    expect(text).toContain(MARK);
    expect(text).not.toContain(JOURNAL_MARK);
  });

  it('an "age" that writes the dump in plain: refused, and the plain file removed', async () => {
    const out = name();
    const plain = fakeAge("age-en-clair", 'cat > "$out"');
    const error = await dumpEncrypted(options(out, { age: plain })).catch((e: unknown) => e);
    expect(String(error)).toMatch(/pas chiffrée : rien ne part/);
    expect(existsSync(out)).toBe(false);
  });

  it('an "age" that writes a header and nothing: refused as empty', async () => {
    const out = name();
    const empty = fakeAge(
      "age-vide",
      "printf 'age-encryption.org/v1\\n' > \"$out\"; cat > /dev/null",
    );
    const error = await dumpEncrypted(options(out, { age: empty })).catch((e: unknown) => e);
    expect(String(error)).toMatch(/vide : rien ne part/);
    expect(existsSync(out)).toBe(false);
  });

  it.each([
    ["a wrong password", { password: "not the copy's one" }, /pg_dump/],
    ["a failing age", { age: "/usr/bin/false" }, /age/],
    ["a recipient age refuses", { recipient: `age1${"q".repeat(58)}` }, /age/],
    [
      "no such container",
      { container: { name: "cenacle-nul-part", address: "172.20.0.3" } },
      /pg_dump/,
    ],
  ])("%s: said, and no file left", async (_what, change, said) => {
    const out = name();
    const error = await dumpEncrypted(options(out, change)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CopieError);
    expect(String(error)).toMatch(said);
    expect(String(error)).toMatch(/rien ne part/);
    expect(existsSync(out)).toBe(false);
  });
});
