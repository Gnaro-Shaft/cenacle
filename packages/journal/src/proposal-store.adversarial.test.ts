// No path to sending without my acceptance — enforced by the database itself,
// whatever the code above it does: no double decision, no late undo, no
// acceptance with a slot left, no second proposal for the same mail.
import { afterAll, describe, expect, it } from "vitest";
import { createProposalStore, ProposalError, UNDO_DELAY_MS } from "./proposal-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const store = createProposalStore(sql);
afterAll(() => sql.end());

let n = 0;
const fresh = (draft = "Bonjour,\n\nC'est noté.") => {
  n++;
  return store.create({
    id: `a-${n}-${Date.now()}`,
    mailUidValidity: "8",
    mailUid: 5000 + n,
    trame: null,
    draft,
  });
};
const T0 = new Date("2026-10-05T10:00:00Z");

describe("proposals — refused transitions", () => {
  it("cannot be accepted while a slot is left for me", async () => {
    const p = await fresh("Bonjour,\n\nJe reviens vers vous {delai ?}.");
    await expect(store.accept(p.id, T0)).rejects.toThrow(/slot to complete/);
  });

  it("the database refuses it too, even bypassing the code", async () => {
    const p = await fresh("Bonjour,\n\nJe reviens vers vous {delai ?}.");
    await expect(
      sql`update proposals set status = 'accepted', decided_at = now(), send_after = now() where id = ${p.id}`,
    ).rejects.toThrow();
  });

  it("a double click accepts once", async () => {
    const p = await fresh();
    await store.accept(p.id, T0);
    await expect(store.accept(p.id, T0)).rejects.toThrow(ProposalError);
  });

  it("a refused proposal cannot be accepted afterwards (replay)", async () => {
    const p = await fresh();
    await store.refuse(p.id, T0);
    await expect(store.accept(p.id, T0)).rejects.toThrow(/it is refused/);
  });

  it("cannot be sent before the undo delay, nor without acceptance", async () => {
    const pending = await fresh();
    await expect(
      store.markSent(pending.id, new Date(T0.getTime() + UNDO_DELAY_MS)),
    ).rejects.toThrow(ProposalError);
    const accepted = await fresh();
    await store.accept(accepted.id, T0);
    await expect(
      store.markSent(accepted.id, new Date(T0.getTime() + UNDO_DELAY_MS - 1)),
    ).rejects.toThrow(ProposalError);
  });

  it("cannot be cancelled once the undo delay is over", async () => {
    const p = await fresh();
    await store.accept(p.id, T0);
    await expect(store.cancel(p.id, new Date(T0.getTime() + UNDO_DELAY_MS))).rejects.toThrow(
      /cannot be cancelled/,
    );
  });

  it("cannot be edited once decided", async () => {
    const p = await fresh();
    await store.accept(p.id, T0);
    await expect(store.edit(p.id, "Autre texte")).rejects.toThrow(/cannot be edited/);
  });

  it("a mail gets one proposal, ever — a refused one does not come back", async () => {
    const p = await fresh();
    await store.refuse(p.id, T0);
    await expect(
      store.create({
        id: `again-${Date.now()}`,
        mailUidValidity: p.mailUidValidity,
        mailUid: p.mailUid,
        trame: null,
        draft: "x",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("the application role cannot delete a proposal (history matters)", async () => {
    const p = await fresh();
    await expect(sql`delete from proposals where id = ${p.id}`).rejects.toThrow(/permission/);
  });

  it.each([
    ["an unknown status", { status: "approved" }],
    ["an unknown reason", { reason: "because" }],
    ["an oversized draft", { draft: "x".repeat(5001) }],
  ])("refuses %s", async (_label, columns) => {
    n++;
    const row = {
      id: `bad-${n}-${Date.now()}`,
      mail_uid_validity: "7",
      mail_uid: 9000 + n,
      reason: "follow_up_due",
      draft: "x",
      ...columns,
    };
    await expect(sql`insert into proposals ${sql(row)}`).rejects.toThrow();
  });
});
