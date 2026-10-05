// The table itself refuses what the code should never write: an address in
// clear where a key belongs, an unknown category, a half-set decision.
import { afterAll, describe, expect, it } from "vitest";
import { createMailStore } from "./mail-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(() => sql.end());

const insert = (columns: Record<string, unknown>) => {
  const row = { mailbox: "inbox", uid_validity: "1", uid: 999, at: new Date(), ...columns };
  return sql`insert into mail_items ${sql(row)}`;
};

describe("mail_items — refused rows", () => {
  it.each([
    ["an address in clear as sender key", { sender_key: "alice@client.example" }],
    ["an uppercase key", { sender_key: "A".repeat(64) }],
    ["a subject as message key", { message_key: "Devis pour une mission" }],
    ["an unknown category", { category: "spam", decided_by: "rule" }],
    ["a category without who decided it", { category: "bruit" }],
    ["an unknown decider", { category: "bruit", decided_by: "intern" }],
    ["a category on a sent mail", { mailbox: "sent", category: "bruit", decided_by: "rule" }],
    ["recipients on an incoming mail", { recipient_keys: ["b".repeat(64)] }],
    ["an unknown mailbox", { mailbox: "drafts" }],
    ["a non-numeric UIDVALIDITY", { uid_validity: "1; drop table events" }],
    ["a zero UID", { uid: 0 }],
    [
      "a set-aside mail anywhere but « À trier » (C2)",
      { category: "clients_prospects", decided_by: "set_aside" },
    ],
    [
      "a refused client rule anywhere but « À trier » (ADR-0014)",
      { category: "clients_prospects", decided_by: "unauthenticated" },
    ],
    ["an authentication left unknown", { sender_authenticated: null }],
  ])("refuses %s", async (_label, columns) => {
    await expect(insert(columns)).rejects.toThrow();
  });

  it("the application role cannot change or drop the table", async () => {
    await expect(sql`alter table mail_items add column subject text`).rejects.toThrow(
      /owner|permission/,
    );
    await expect(sql`drop table mail_items`).rejects.toThrow(/owner|permission/);
  });
});

describe("mail_items — set aside by the article 9 floor (C2)", () => {
  it("a set-aside urgent mail still gets its alert: never lost silently", async () => {
    const store = createMailStore(sql);
    const since = new Date(Date.now() - 60_000);
    // The test database is shared: keep the mailbox numbering already there, if any.
    const validity = (await store.position("inbox"))?.uidValidity ?? "424242";
    await store.saveInbox(validity, [
      {
        uid: 4242,
        receivedAt: new Date().toISOString(),
        noFollowUp: false,
        urgentTerm: true,
        senderAuthenticated: true,
        senderKey: "c".repeat(64),
        messageKey: "d".repeat(64),
        threadKeys: [],
      },
    ]);
    await store.categorize(4242, "a_trier", "set_aside");
    expect(await store.urgentToNotify(since)).toContain(4242);
    const [row] = await sql<{ decided_by: string }[]>`
      select decided_by from mail_items where uid = 4242 and uid_validity = ${validity}`;
    // One mark for every reason: nothing says why.
    expect(row?.decided_by).toBe("set_aside");
  });
});

describe("mail_items — sender authentication (ADR-0014)", () => {
  it("an urgent client mail alerts only when its sender is authenticated", async () => {
    const store = createMailStore(sql);
    const since = new Date(Date.now() - 60_000);
    const validity = (await store.position("inbox"))?.uidValidity ?? "424242";
    const item = (uid: number, senderAuthenticated: boolean) => ({
      uid,
      receivedAt: new Date().toISOString(),
      noFollowUp: false,
      urgentTerm: true,
      senderAuthenticated,
      senderKey: "c".repeat(64),
      messageKey: "e".repeat(64),
      threadKeys: [],
    });
    await store.saveInbox(validity, [item(4243, true), item(4244, false), item(4245, false)]);
    await store.categorize(4243, "clients_prospects", "rule");
    // Even a client decided by the model: an unauthenticated sender never rings.
    await store.categorize(4244, "clients_prospects", "model");
    await store.categorize(4245, "a_trier", "unauthenticated");
    const urgent = await store.urgentToNotify(since);
    expect(urgent).toContain(4243);
    expect(urgent).not.toContain(4244);
    expect(urgent).not.toContain(4245);
    const rows = (await store.inbox()).filter((r) => r.uid >= 4243 && r.uid <= 4245);
    expect(rows.map((r) => [r.uid, r.senderAuthenticated, r.decidedBy])).toEqual([
      [4243, true, "rule"],
      [4244, false, "model"],
      [4245, false, "unauthenticated"],
    ]);
  });

  it("a row written without saying is not authenticated (the protective default)", async () => {
    const validity = (await createMailStore(sql).position("inbox"))?.uidValidity ?? "424242";
    await insert({ uid_validity: validity, uid: 4246 });
    const [row] = await sql<{ sender_authenticated: boolean }[]>`
      select sender_authenticated from mail_items where uid = 4246 and uid_validity = ${validity}`;
    expect(row?.sender_authenticated).toBe(false);
  });
});
