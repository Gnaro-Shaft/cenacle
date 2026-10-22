// Every migration runs again at each `db:migrate`, on a database that already
// holds rows in every state: none may refuse a row written by a later one.
// (B7's failed-without-sending-time rows broke 007 on a real database.)
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createMailStore } from "./mail-store.ts";
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

describe("mail rows decided by every decider survive a replay (ADR-0029)", () => {
  const mails = createMailStore(sql);
  const base = 900_000 + (Date.now() % 50_000) * 10;
  const item = (uid: number) => ({
    uid,
    receivedAt: "2026-10-21T08:00:00Z",
    noFollowUp: false,
    urgentTerm: false,
    senderAuthenticated: true,
    senderKey: null,
    messageKey: null,
    threadKeys: [],
  });

  it("'masse' rows, then db:migrate again: 011 and 013 refuse nothing", async () => {
    const rows = [
      [base + 1, "bruit", "masse"],
      [base + 2, "a_trier", "unauthenticated"],
      [base + 3, "a_trier", "set_aside"],
      [base + 4, "administratif", "rule"],
    ] as const;
    await mails.saveInbox(
      "29",
      rows.map(([uid]) => item(uid)),
    );
    for (const [uid, category, by] of rows) {
      expect(await mails.categorize(uid, category, by)).toBe(true);
    }
    await expect(
      migrate({
        ownerUrl: ownerUrlFromEnv(TEST_DB),
        appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
        executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      }),
    ).resolves.toContain("025_mail_items_masse.sql");
  });

  it.each(["clients_prospects", "administratif", "a_trier"] as const)(
    "'masse' with %s is refused by the database: a mass mail is noise only",
    async (category) => {
      const uid = base + 10 + ["clients_prospects", "administratif", "a_trier"].indexOf(category);
      await mails.saveInbox("29", [item(uid)]);
      await expect(mails.categorize(uid, category, "masse")).rejects.toThrow(/masse_is_bruit/);
    },
  );
});

describe("the missions box (ADR-0031): only a rule puts a mail there", () => {
  const mails = createMailStore(sql);
  const base = 950_000 + (Date.now() % 50_000) * 10;
  const item = (uid: number) => ({
    uid,
    receivedAt: "2026-10-22T08:00:00Z",
    noFollowUp: false,
    urgentTerm: false,
    senderAuthenticated: true,
    senderKey: null,
    messageKey: null,
    threadKeys: [],
  });

  it("a 'missions' row decided by a rule, then db:migrate again: nothing refused", async () => {
    await mails.saveInbox("29", [item(base)]);
    expect(await mails.categorize(base, "missions", "rule")).toBe(true);
    await expect(
      migrate({
        ownerUrl: ownerUrlFromEnv(TEST_DB),
        appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
        executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      }),
    ).resolves.toContain("026_mail_items_missions.sql");
    expect((await mails.totals()).missions).toBeGreaterThanOrEqual(1);
  });

  it.each(["model", "masse", "unauthenticated", "unreadable", "set_aside"] as const)(
    "'missions' decided by %s is refused by the database",
    async (decidedBy) => {
      const uid =
        base +
        1 +
        ["model", "masse", "unauthenticated", "unreadable", "set_aside"].indexOf(decidedBy);
      await mails.saveInbox("29", [item(uid)]);
      await expect(mails.categorize(uid, "missions", decidedBy)).rejects.toThrow(
        /missions_by_rule|masse_is_bruit/,
      );
    },
  );

  it("an unknown box is still refused: the list was widened, not removed", async () => {
    await mails.saveInbox("29", [item(base + 9)]);
    await expect(mails.categorize(base + 9, "spam" as unknown as "bruit", "rule")).rejects.toThrow(
      /category_check/,
    );
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
