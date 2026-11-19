// ADR-0044, points 7, 8 and 10, on real bases: a source with rows in the four
// tables, copied for real (pg_dump as cenacle_copie, through age), restored
// into a target base by the owner's psql. Checked: the same rows, sums and
// sequences; the writers stopped, then started again; nothing stopped and
// nothing changed when it refuses — tables not empty, the findings' dependents
// in use, a forged copy, a wrong key, a base behind its migrations; a failure
// inside the transaction changes nothing and says no row; the purges
// replayed; a trial stops nothing and compares.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COPIE_PASSWORD_VAR, EXECUTOR_PASSWORD_VAR } from "@cenacle/journal";
import { loadEnv, migrate, ownerUrlFromEnv, requireEnv } from "@cenacle/journal/test-db";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Container, dumpEncrypted, findContainer, findTool, TOOLS } from "./export.ts";
import { fingerprints } from "./recharge.ts";
import { type RestoreDeps, type RestoreResult, runRestore } from "./restaurer.ts";
import type { ServiceDeps } from "./services.ts";

const SRC = "cenacle_restaurer_source";
const DST = "cenacle_restaurer_cible";
const DIR = mkdtempSync(join(tmpdir(), "cenacle-restaurer-"));
const docker = findTool(TOOLS.docker) ?? "docker";
const age = findTool(TOOLS.age) ?? "age";
const MARK = `marque-restauree-${Date.now()}`;
let container: Container = { name: "", address: "" };
const keys = { good: "", other: "" };
const copies = { real: join(DIR, "vraie.age"), forged: join(DIR, "fausse.age") };

const owner = (db: string) => postgres(ownerUrlFromEnv(db), { max: 1, onnotice: () => {} });
async function asOwner<T>(db: string, run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = owner(db);
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

function keygen(name: string): { key: string; recipient: string } {
  const file = join(DIR, name);
  execFileSync(`${age}-keygen`, ["-o", file], { stdio: "ignore" });
  const lines = readFileSync(file, "utf8").split("\n");
  const recipient = execFileSync(`${age}-keygen`, ["-y", file], { encoding: "utf8" }).trim();
  rmSync(file);
  return { key: lines.find((l) => l.startsWith("AGE-SECRET-KEY-")) ?? "", recipient };
}

async function seed(sql: postgres.Sql): Promise<void> {
  await sql`insert into rappels (texte, echeance) values (${MARK}, now() + interval '1 day')`;
  await sql`insert into rappels (texte, echeance) values ('effacé avant la copie', now())`;
  await sql`delete from rappels where texte = 'effacé avant la copie'`;
  // Rang 400 days ago: a purge at 30 days takes it, one at 3650 keeps it.
  await sql`insert into rappels (texte, echeance, pose_le, sonne_le)
            values ('ancien', now() - interval '400 days', now() - interval '401 days',
                    now() - interval '400 days')`;
  await sql`insert into prospection_cartes (source, title, intermediary, stack, remote,
            board_column, decided_by, to_check)
            values ('me', 'Mission essai', 'direct', '{}', 'inconnu', 'detected', 'me', false)`;
  await sql`insert into veille_articles (link, source, theme, title, published_at, score)
            values ('https://exemple.test/a', 'essai', 'actualite', 'Titre', now(), 5)`;
  await sql`insert into securite_constats (type, target, occurrence, check_name, severity,
            title, status, first_seen, last_seen)
            values ('essai', 'cible', 'x', 'essai', 'faible', 'Constat', 'ouvert', now(), now())`;
}

/** A forged copy: encrypted for the right key, holding the journal too. */
function forge(recipient: string): void {
  const tables = [
    "rappels",
    "prospection_cartes",
    "veille_articles",
    "securite_constats",
    "events",
  ];
  const args = ["exec", "-e", "PGPASSWORD", container.name, "pg_dump", "-h", container.address];
  args.push("-U", "cenacle_owner", "-d", SRC, "--data-only", "--format=custom");
  const dump = execFileSync(
    docker,
    [...args, ...tables.flatMap((t) => ["--table", `public.${t}`])],
    {
      env: { ...process.env, PGPASSWORD: requireEnv("CENACLE_DB_OWNER_PASSWORD") },
    },
  );
  execFileSync(age, ["-r", recipient, "-o", copies.forged], { input: dump });
}

beforeAll(async () => {
  loadEnv();
  await asOwner("postgres", async (admin) => {
    for (const db of [SRC, DST]) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${db}`);
    }
  });
  for (const db of [SRC, DST]) {
    await migrate({
      ownerUrl: ownerUrlFromEnv(db),
      appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
      executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      copiePassword: requireEnv(COPIE_PASSWORD_VAR),
    });
  }
  await asOwner(SRC, seed);
  container = findContainer(docker, process.env.CENACLE_DB_PORT ?? "55432") ?? container;
  const good = keygen("bonne");
  keys.good = good.key;
  keys.other = keygen("autre").key;
  await dumpEncrypted({
    docker,
    age,
    container,
    database: SRC,
    password: requireEnv(COPIE_PASSWORD_VAR),
    recipient: good.recipient,
    out: copies.real,
  });
  forge(good.recipient);
}, 180_000);

afterAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  await asOwner("postgres", async (admin) => {
    for (const db of [SRC, DST]) await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  });
});

beforeEach(async () => {
  await asOwner(DST, (sql) =>
    sql.unsafe(`TRUNCATE rappels, prospection_cartes, veille_articles, securite_constats,
                securite_raisons, serveur_actions RESTART IDENTITY CASCADE`),
  );
});

/** All six writers loaded; each stops at once. Every call noted. */
function services(): { deps: ServiceDeps; calls: string[]; hold: () => () => void } {
  const calls: string[] = [];
  // The signals held: noted with the calls, to see what they surround.
  const hold = () => {
    calls.push("hold");
    return () => calls.push("release");
  };
  const gone = new Set<string>();
  const deps: ServiceDeps = {
    uid: 501,
    home: "/Users/essai",
    pause: async () => undefined,
    launchctl: async (args) => {
      calls.push(args.join(" "));
      const label = (args[1] ?? "").split("/").pop() ?? "";
      if (args[0] === "bootout") gone.add(label);
      if (args[0] === "print") return { code: gone.has(label) ? 113 : 0, output: "" };
      return { code: 0, output: "" };
    },
  };
  return { deps, calls, hold };
}

function restore(change: Partial<RestoreDeps> = {}): Promise<RestoreResult> {
  return runRestore({
    file: copies.real,
    mode: "vides",
    readKey: async () => keys.good,
    tools: { docker, age },
    container: () => container,
    database: DST,
    production: SRC,
    ownerPassword: requireEnv("CENACLE_DB_OWNER_PASSWORD"),
    connect: owner,
    services: services().deps,
    retentions: () => ({ rappelsJours: 3650, prospectionJours: 3650, veilleJours: 730 }),
    now: () => new Date(),
    ...change,
  });
}

const print = (db: string) => asOwner(db, (sql) => fingerprints(sql));
const allSame = (r: RestoreResult) => [...(r.same ?? new Map()).values()];
const started = (calls: string[]) => calls.filter((c) => c.startsWith("bootstrap")).length;

async function actionOnAFinding(): Promise<void> {
  await asOwner(DST, async (sql) => {
    const [f] = await sql<{ id: string }[]>`select id from securite_constats limit 1`;
    await sql`insert into serveur_actions (finding_id, host, action, state, requested_at,
              confirm_until) values (${f?.id ?? 0}, 'machine', 'services', 'demandee', now(),
              now() + interval '1 minute')`;
  });
}

describe("npm run base:restaurer, on real bases", () => {
  it("reloads empty tables: same rows, sums, sequences; writers stopped, then started", async () => {
    const s = services();
    const result = await restore({ services: s.deps, holdSignals: s.hold });
    expect(allSame(result)).toEqual([true, true, true, true]);
    // Held from before the first stop to after the last start.
    expect(s.calls[0]).toBe("hold");
    expect(s.calls.at(-1)).toBe("release");
    expect(s.calls.filter((c) => c === "hold" || c === "release")).toHaveLength(2);
    expect(result.rows.get("rappels")).toBe(2);
    const writers = ["bot", "server", "securite", "veille", "prospection", "operateur"];
    expect(result.stopped).toEqual(writers);
    expect(result.notRestarted).toEqual([]);
    expect(s.calls.filter((c) => c.startsWith("bootout")).length).toBe(6);
    expect(started(s.calls)).toBe(6);
    // The sequence came back: a new reminder does not take a restored one's number.
    const [next] = await asOwner(
      DST,
      (sql) =>
        sql<
          { id: string }[]
        >`insert into rappels (texte, echeance) values ('après', now()) returning id`,
    );
    expect(Number(next?.id)).toBe(4);
  });

  it("refuses tables not empty, without --remplacer: nothing stopped, nothing changed", async () => {
    await restore();
    const before = await print(DST);
    const s = services();
    await expect(restore({ services: s.deps })).rejects.toThrow(
      /ne sont pas vides : rappels \(2 lignes\)/,
    );
    expect(s.calls).toEqual([]);
    expect(await print(DST)).toEqual(before);
  });

  it("--remplacer empties and reloads, in one transaction", async () => {
    await restore();
    await asOwner(DST, async (sql) => {
      await sql`delete from veille_articles`;
      await sql`insert into rappels (texte, echeance) values ('ajouté depuis', now())`;
    });
    expect(allSame(await restore({ mode: "remplacer" }))).toEqual([true, true, true, true]);
  });

  it("--remplacer refuses while an action points at a finding: nothing stopped", async () => {
    await restore();
    await actionOnAFinding();
    const before = await print(DST);
    const s = services();
    await expect(restore({ mode: "remplacer", services: s.deps })).rejects.toThrow(
      /serveur_actions \(1 lignes\), qui ne sont pas copiées/,
    );
    expect(s.calls).toEqual([]);
    expect(await print(DST)).toEqual(before);
  });

  it.each([
    ["a forged copy holding the journal", { file: copies.forged }, /autre chose que les quatre/],
    ["a wrong key", { readKey: async () => keys.other }, /ne déchiffre pas/],
  ] as const)("refuses %s before anything stops", async (_what, change, said) => {
    const s = services();
    await expect(restore({ ...change, services: s.deps })).rejects.toThrow(said);
    expect(s.calls).toEqual([]);
    expect((await print(DST)).get("rappels")?.rows).toBe(0);
  });

  it("refuses a base behind its migrations, and says db:migrate", async () => {
    await asOwner(DST, (sql) => sql`alter table veille_articles rename column idea to idee_essai`);
    const s = services();
    try {
      await expect(restore({ services: s.deps })).rejects.toThrow(
        /veille_articles\.idea\) : npm run db:migrate/,
      );
      expect(s.calls).toEqual([]);
    } finally {
      await asOwner(
        DST,
        (sql) => sql`alter table veille_articles rename column idee_essai to idea`,
      );
    }
  });

  it("a failure inside the transaction: nothing changed, no row said, writers started", async () => {
    await restore();
    const before = await print(DST);
    await asOwner(DST, (sql) =>
      sql.unsafe(
        `alter table rappels add constraint essai_echec check (texte <> '${MARK}') not valid`,
      ),
    );
    const s = services();
    try {
      const error = await restore({
        mode: "remplacer",
        services: s.deps,
        holdSignals: s.hold,
      }).catch((e: unknown) => e);
      expect(String(error)).toMatch(/la transaction est annulée, aucune table n'a changé/);
      expect(String(error)).not.toContain(MARK);
      expect(started(s.calls)).toBe(6);
      expect(s.calls.at(-1)).toBe("release");
    } finally {
      await asOwner(DST, (sql) => sql`alter table rappels drop constraint essai_echec`);
    }
    expect(await print(DST)).toEqual(before);
  });

  it("replays the purges with the services' retentions", async () => {
    const result = await restore({
      retentions: () => ({ rappelsJours: 30, prospectionJours: undefined, veilleJours: 730 }),
    });
    expect(result.purged.get("rappels")).toBe(1);
    expect(result.purged.get("prospection_cartes")).toBeNull();
    expect(result.rows.get("rappels")).toBe(1);
    expect(result.same?.get("rappels")).toBe(false);
  });

  it("a purge that fails: said reloaded, purges not replayed; writers started", async () => {
    const s = services();
    const error = await restore({
      services: s.deps,
      holdSignals: s.hold,
      retentions: () => ({ rappelsJours: Number.NaN, prospectionJours: 1, veilleJours: 730 }),
    }).catch((e: unknown) => e);
    expect(String(error)).toMatch(/la copie est rechargée, mais ses purges n'ont pas été rejouées/);
    expect(started(s.calls)).toBe(6);
    expect(s.calls.at(-1)).toBe("release");
    expect((await print(DST)).get("rappels")?.rows).toBe(2);
  });

  it("a trial stops nothing, takes the dependents away, and compares", async () => {
    await restore();
    await actionOnAFinding();
    const result = await restore({ mode: "essai", services: null });
    expect(result.stopped).toEqual([]);
    expect(allSame(result)).toEqual([true, true, true, true]);
    await asOwner(SRC, (sql) => sql`update veille_articles set score = 6`);
    try {
      const again = await restore({ mode: "essai", services: null });
      expect(again.same?.get("veille_articles")).toBe(false);
      expect(again.same?.get("rappels")).toBe(true);
      // The same rows, but the sequence moved on: not the same.
      await asOwner(SRC, (sql) => sql`select nextval('rappels_id_seq')`);
      expect((await restore({ mode: "essai", services: null })).same?.get("rappels")).toBe(false);
    } finally {
      await asOwner(SRC, async (sql) => {
        await sql`update veille_articles set score = 5`;
        await sql`select setval('rappels_id_seq', 3, true)`;
      });
    }
  });
});
