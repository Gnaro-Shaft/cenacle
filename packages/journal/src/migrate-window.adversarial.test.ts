// db:migrate while the programs run (lot F2, 13/11): one transaction, so a
// program never sees a table without its trigger nor a role without its
// rights. A client of the application's role writes and reads the journal
// without pause while migrate runs again and again: nothing is refused, and
// the journal stays append-only all along.
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { EXECUTOR_PASSWORD_VAR, migrate, ownerUrlFromEnv, requireEnv } from "./migrate.ts";
import { appConnection, loadEnv, TEST_DB } from "./test-db.ts";

describe("db:migrate while the programs run", () => {
  it("the app role is never refused, and the journal never becomes changeable", async () => {
    loadEnv();
    const app = appConnection();
    const owner = postgres(ownerUrlFromEnv(TEST_DB), { infer: true, max: 1, onnotice: () => {} });
    const errors: string[] = [];
    let changed = 0;
    let rounds = 0;
    let running = true;
    const client = (async () => {
      while (running) {
        try {
          await app`insert into events (agent, type, payload) values ('f2-probe', 'heartbeat', '{}')`;
          await app`select count(*) from events where agent = 'f2-probe'`;
          rounds++;
        } catch (error) {
          errors.push(String((error as { code?: string }).code ?? error));
        }
      }
    })();
    const owned = (async () => {
      // As the owner (who holds every right), an update is refused by the trigger alone.
      while (running) {
        try {
          const r = await owner`update events set payload = '{"x":1}' where agent = 'f2-probe'`;
          changed += r.count;
        } catch {
          // refused: the trigger is there
        }
      }
    })();
    try {
      for (let i = 0; i < 4; i++) {
        await migrate({
          ownerUrl: ownerUrlFromEnv(TEST_DB),
          appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
          executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
        });
      }
    } finally {
      running = false;
      await Promise.all([client, owned]);
      await app.end();
      await owner.end();
    }
    expect(rounds).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(changed).toBe(0);
  }, 120_000);
});
