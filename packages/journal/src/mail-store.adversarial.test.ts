// The table itself refuses what the code should never write: an address in
// clear where a key belongs, an unknown category, a half-set decision.
import { afterAll, describe, expect, it } from "vitest";
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
