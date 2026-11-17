// ADR-0044, point 10: without a valid recipient, a private key, a pinned
// node, the tools or the database, nothing leaves — and the program says so;
// when age or the push fails, nothing is left behind on the Mac. And, read in
// the code: pg_dump through the network, its password by name, its output
// never written; the push key named in one file; the push never deletes.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type CopieDeps, copyName, runCopie } from "./copie.ts";
import { CopieError, type DumpOptions, dumpArgs } from "./export.ts";
import { COPY_NAME, rsyncArgs, sshCommand } from "./pousser.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BASE = mkdtempSync(join(tmpdir(), "cenacle-copie-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const RECIPIENT = `age1${"q".repeat(58)}`;
const CONFIG = [
  `destinataire = "${RECIPIENT}"`,
  'known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"',
  'adresse = "sauvegarde.exemple.test"',
  'compte = "cenacle-depot"',
].join("\n");
const PASTED_PRIVATE = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;

let n = 0;
function world(change: Partial<CopieDeps> = {}) {
  const tmp = join(BASE, `t${n++}`);
  mkdirSync(tmp);
  const calls = { dump: [] as DumpOptions[], push: [] as string[][] };
  const deps: CopieDeps = {
    readConfig: () => CONFIG,
    pushKey: "/Users/exemple/.ssh/cenacle/copie-pousser",
    keyOk: () => true,
    knownHostsOk: () => true,
    tools: { docker: "/fake/docker", age: "/fake/age", rsync: "/fake/rsync" },
    container: () => ({ name: "cenacle-db-1", address: "172.20.0.3" }),
    password: "a synthetic one",
    database: "cenacle",
    tmp,
    dump: async (o) => {
      calls.dump.push(o);
      writeFileSync(o.out, "age-encryption.org/v1\n…");
      return 4096;
    },
    push: async (_rsync, args) => {
      calls.push.push([...args]);
      return 0;
    },
    now: () => new Date("2026-11-18T01:30:00Z"),
    ...change,
  };
  return { deps, calls, left: () => readdirSync(tmp) };
}

describe("nothing leaves when something is missing", () => {
  it.each<[string, Partial<CopieDeps>, RegExp]>([
    ["no copie.local.toml", { readConfig: () => null }, /absent/],
    [
      "a private key as recipient",
      { readConfig: () => CONFIG.replace(RECIPIENT, PASTED_PRIVATE) },
      /PRIVATE key/,
    ],
    [
      "a recipient out of shape",
      { readConfig: () => CONFIG.replace(RECIPIENT, "age1short") },
      /age public key/,
    ],
    ["a push key others can read", { keyOk: () => false }, /clé de poussée/],
    ["no pinned known_hosts", { knownHostsOk: () => false }, /known_hosts/],
    ["no docker", { tools: { docker: null, age: "/a", rsync: "/r" } }, /docker/],
    ["no age", { tools: { docker: "/d", age: null, rsync: "/r" } }, /age est introuvable/],
    ["no rsync 3", { tools: { docker: "/d", age: "/a", rsync: null } }, /rsync 3/],
    ["no single database container", { container: () => null }, /conteneur/],
  ])("%s: said, nothing exported, nothing pushed", async (_what, change, said) => {
    const w = world(change);
    const error = await runCopie(w.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CopieError);
    expect(String(error)).toMatch(said);
    expect(String(error)).not.toContain(BASE);
    expect(String(error)).not.toContain("Q".repeat(10));
    expect(w.calls.dump).toEqual([]);
    expect(w.calls.push).toEqual([]);
    expect(w.left()).toEqual([]);
  });

  it("age or pg_dump fails: no push, and the folder is gone", async () => {
    const w = world({
      dump: async () => {
        throw new CopieError("le chiffrement (age) a échoué (code 1) : rien ne part");
      },
    });
    await expect(runCopie(w.deps)).rejects.toThrow(/rien ne part/);
    expect(w.calls.push).toEqual([]);
    expect(w.left()).toEqual([]);
  });

  it("the push fails: said with rsync's code, and the encrypted copy is removed", async () => {
    const w = world({ push: async () => 255 });
    await expect(runCopie(w.deps)).rejects.toThrow(/poussée .* \(code 255\)/);
    expect(w.left()).toEqual([]);
  });
});

describe("a copy that leaves", () => {
  it("is encrypted for the declared key, pushed once, by name, and removed after", async () => {
    const w = world();
    const result = await runCopie(w.deps);
    expect(result.name).toMatch(COPY_NAME);
    expect(result.name.startsWith("cenacle-2026-11-18-")).toBe(true);
    expect(w.calls.dump).toHaveLength(1);
    expect(w.calls.dump[0]?.recipient).toBe(RECIPIENT);
    expect(w.calls.dump[0]?.database).toBe("cenacle");
    expect(w.calls.push).toHaveLength(1);
    const args = w.calls.push[0] ?? [];
    expect(args.at(-1)).toBe("sauvegarde.exemple.test:");
    expect(args.at(-2)).toBe(w.calls.dump[0]?.out);
    expect(args.join(" ")).not.toMatch(/--delete|--remove|PASSWORD|synthetic one/);
    expect(w.left()).toEqual([]);
  });

  it("two copies of one night never share a name", () => {
    const d = new Date("2026-11-18T01:30:00Z");
    expect(new Set(Array.from({ length: 200 }, () => copyName(d))).size).toBe(200);
  });
});

describe("read in the code", () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, f), "utf8");

  it("pg_dump: the network, the copy's role, the four tables, the password by name", () => {
    const args = dumpArgs({ name: "cenacle-db-1", address: "172.20.0.3" }, "cenacle");
    expect(args.slice(0, 4)).toEqual(["exec", "-e", "PGPASSWORD", "cenacle-db-1"]);
    expect(args.join(" ")).toContain("-h 172.20.0.3 -U cenacle_copie -d cenacle --data-only");
    // Never a connection the image trusts without a password (its pg_hba).
    for (const address of ["127.0.0.1", "127.1.2.3", "localhost", "", "::1", "1.2.3"]) {
      expect(() => dumpArgs({ name: "c", address }, "cenacle"), address).toThrow(CopieError);
    }
    expect(args.filter((a) => a.includes("="))).toEqual(["--format=custom"]);
    expect(args).not.toContain("-f");
    expect(args).not.toContain("--file");
    expect(args.filter((_a, i) => args[i - 1] === "--table").sort()).toEqual([
      "public.prospection_cartes",
      "public.rappels",
      "public.securite_constats",
      "public.veille_articles",
    ]);
  });

  it("the plain dump is never written: pg_dump's output is age's input", () => {
    const text = src("export.ts");
    expect(text).toMatch(/stdio: \[dump\.stdout,/);
    expect(text).not.toMatch(/writeFile|createWriteStream|appendFile|writeSync/);
    for (const f of ["copie.ts", "main.ts", "pousser.ts"]) {
      expect(src(f), f).not.toMatch(/pg_dump|createWriteStream|appendFile/);
    }
  });

  it("the push: pinned node, no agent, no deletion, a copy's name only", () => {
    const c = {
      recipient: "",
      knownHosts: "/k",
      address: "h.exemple.test",
      port: 22,
      account: "cenacle-depot",
    };
    const ssh = sshCommand(c, "/key");
    for (const o of [
      "StrictHostKeyChecking=yes",
      "IdentityAgent=none",
      "BatchMode=yes",
      "GlobalKnownHostsFile=/dev/null",
      "-F /dev/null",
    ]) {
      expect(ssh).toContain(o);
    }
    expect(() => rsyncArgs(c, "/key", "/tmp/x/etc-passwd")).toThrow();
    const ok = "/tmp/x/cenacle-2026-11-18-0011223344556677.age";
    expect(rsyncArgs(c, "/key", ok)).not.toContain("--delete");
  });

  it("only the copy's config names the push key, in the whole code base", () => {
    const holders: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of readdirSync(join(ROOT, top), { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts") || file.includes("node_modules") || file.includes(".test.")) {
          continue;
        }
        if (readFileSync(join(ROOT, top, file), "utf8").includes("copie-pousser")) {
          holders.push(`${top}/${file}`);
        }
      }
    }
    expect(holders).toEqual(["apps/copie/src/config.ts"]);
  });
});
