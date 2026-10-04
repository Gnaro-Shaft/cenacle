// Every migration runs again at each `db:migrate`, on a database that already
// holds rows in every state: none may refuse a row written by a later one.
// (B7's failed-without-sending-time rows broke 007 on a real database.)
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  appUrlFromEnv,
  EXECUTOR_PASSWORD_VAR,
  migrate,
  ownerUrlFromEnv,
  requireEnv,
} from "./migrate.ts";
import { createProposalStore } from "./proposal-store.ts";
import { createPurges } from "./purges.ts";
import { appConnection, executorConnection, TEST_DB } from "./test-db.ts";

const sql = appConnection();
const execSql = executorConnection();
const store = createProposalStore(sql);
const executor = createProposalStore(execSql);
afterAll(async () => {
  await sql.end();
  await execSql.end();
});

const T0 = new Date("2026-10-05T10:00:00Z");
const AFTER = new Date(T0.getTime() + 120_000);
let n = 0;
const fresh = () => {
  n++;
  return store.create({
    id: `remig-${n}-${Date.now()}`,
    mailUidValidity: "6",
    mailUid: 6000 + n,
    trame: null,
    draft: "Bonjour,\n\nC'est noté.",
  });
};
const signed = (draft: string | null) => ({
  signature: "s".repeat(86),
  draftHash: createHash("sha256")
    .update(draft ?? "", "utf8")
    .digest("hex"),
});

describe("migrations run again on a populated database", () => {
  it("rows in every state, then db:migrate again: nothing refused", async () => {
    await fresh(); // pending
    const refused = await fresh();
    await store.refuse(refused.id, T0);
    const accepted = await fresh();
    await store.accept(accepted.id, T0, signed(accepted.draft));
    const unsigned = await fresh();
    await store.accept(unsigned.id, T0, signed(unsigned.draft));
    await executor.refuseUnsigned(unsigned.id, AFTER); // failed, no sending time
    const sent = await fresh();
    await store.accept(sent.id, T0, signed(sent.draft));
    await executor.claim(sent.id, AFTER);
    await executor.markSent(sent.id, AFTER);
    await store.skip({ id: `remig-skip-${Date.now()}`, mailUidValidity: "6", mailUid: 6999 }, T0);
    await createPurges(sql).events(new Date("2021-01-01T00:00:00Z"));

    await expect(
      migrate({
        ownerUrl: ownerUrlFromEnv(TEST_DB),
        appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
        executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      }),
    ).resolves.toContain("010_purges.sql");
    expect((await store.get(unsigned.id))?.status).toBe("failed");
    expect((await store.get(accepted.id))?.status).toBe("accepted");
  });
});

describe("the programs connect without the owner's password (S1)", () => {
  it("the application's connection needs only its own password", () => {
    const env = { CENACLE_DB_APP_PASSWORD: "app_only_password_000", CENACLE_DB_PORT: "55432" };
    expect(appUrlFromEnv("cenacle", env)).toContain("cenacle_app:");
    expect(appUrlFromEnv("cenacle", env)).not.toContain("owner");
    expect(() => appUrlFromEnv("cenacle", {})).toThrow(/CENACLE_DB_APP_PASSWORD/);
  });
});
