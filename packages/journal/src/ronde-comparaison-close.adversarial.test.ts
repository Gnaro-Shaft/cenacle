// R4 (ADR-0040): migration 037 closes the comparison's findings, which no
// check can close any more — on the real PostgreSQL, through the real
// `migrate`. Only `ronde_comparaison`, only candidate or open: closed quietly
// (caduc, a closing date, no button), never announced; an accepted finding,
// one already closed and another check's finding are left exactly as they
// were. Run again, it changes nothing.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { COPIE_PASSWORD_VAR, EXECUTOR_PASSWORD_VAR } from "./migrate.ts";
import { createSecuriteStore } from "./securite-store.ts";
import { appConnection, migrate, ownerUrlFromEnv, requireEnv, TEST_DB } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const run = randomBytes(4).toString("hex");
const SEEN = new Date("2026-11-16T00:27:00Z");
const CLOSED = new Date("2026-11-18T23:49:00Z");

const migrateAgain = () =>
  migrate({
    ownerUrl: ownerUrlFromEnv(TEST_DB),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
    executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
    copiePassword: requireEnv(COPIE_PASSWORD_VAR),
  });

interface Row {
  status: string;
  closed_at: Date | null;
  button_token: string | null;
  reason: string | null;
  signaled_close: boolean;
}

async function insert(
  name: string,
  check: string,
  status: string,
  extra: { closed?: Date; accepted?: true; button?: string } = {},
): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into securite_constats
      (type, target, occurrence, check_name, severity, title, status,
       first_seen, last_seen, closed_at, reason, accepted_at, signaled_open, button_token)
    values ('ronde_ecart', ${`r4-${run}-${name}`}, '1', ${check}, 'info', ${`Constat ${name}`},
       ${status}, ${SEEN}, ${SEEN}, ${extra.closed ?? null},
       ${extra.accepted ? "écart expliqué" : null}, ${extra.accepted ? SEEN : null},
       ${status === "ouvert"}, ${extra.button ?? null})
    returning id`;
  if (row === undefined) throw new Error("no row");
  return row.id;
}
const read = async (id: number): Promise<Row> => {
  const [row] = await sql<Row[]>`
    select status, closed_at, button_token, reason, signaled_close
    from securite_constats where id = ${id}`;
  if (row === undefined) throw new Error("row gone");
  return row;
};

describe("migration 037: the comparison's findings, closed once Legion is gone", () => {
  it("open and candidate ones closed quietly; everything else exactly as it was", async () => {
    const open = await insert("ouvert", "ronde_comparaison", "ouvert", {
      button: randomBytes(8).toString("hex"),
    });
    const candidate = await insert("candidat", "ronde_comparaison", "candidat");
    const accepted = await insert("accepte", "ronde_comparaison", "accepte", { accepted: true });
    const resolved = await insert("resolu", "ronde_comparaison", "resolu", { closed: CLOSED });
    const servers = await insert("serveurs", "legion_ronde", "ouvert");
    const before = {
      accepted: await read(accepted),
      resolved: await read(resolved),
      servers: await read(servers),
    };

    const started = Date.now();
    await migrateAgain();

    for (const id of [open, candidate]) {
      const row = await read(id);
      expect(row.status).toBe("caduc");
      expect(row.closed_at?.getTime()).toBeGreaterThanOrEqual(started - 60_000);
      expect(row.button_token).toBeNull();
      expect(row.signaled_close).toBe(false);
    }
    expect(await read(accepted)).toEqual(before.accepted);
    expect(await read(resolved)).toEqual(before.resolved);
    expect(await read(servers)).toEqual(before.servers);
  });

  it("closed as caduc: nothing to tell me, unlike a resolved finding", async () => {
    const id = await insert("muet", "ronde_comparaison", "ouvert");
    await migrateAgain();
    const toTell = await createSecuriteStore(sql).toSignal();
    expect(toTell.resolved.map((f) => f.id)).not.toContain(id);
    expect((await createSecuriteStore(sql).active()).map((f) => f.id)).not.toContain(id);
  });

  it("run again: nothing changes, the closing date stays the first one", async () => {
    const id = await insert("rejoue", "ronde_comparaison", "ouvert");
    await migrateAgain();
    const first = await read(id);
    await migrateAgain();
    expect(await read(id)).toEqual(first);
  });
});
