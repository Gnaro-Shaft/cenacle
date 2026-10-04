import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createProposalStore, UNDO_DELAY_MS } from "./proposal-store.ts";
import { appConnection, executorConnection } from "./test-db.ts";

/** What the page would hand over: the database checks the form and the text, not the key. */
const signedFor = (draft: string | null) => ({
  signature: "s".repeat(86),
  draftHash: createHash("sha256")
    .update(draft ?? "", "utf8")
    .digest("hex"),
});

const sql = appConnection();
const store = createProposalStore(sql);
// Claiming and closing a sending: the executor's role only (B7).
const execSql = executorConnection();
const executor = createProposalStore(execSql);
afterAll(async () => {
  await sql.end();
  await execSql.end();
});

let n = 0;
const fresh = (draft = "Bonjour Julien,\n\nVendredi à 10 h me convient.") => {
  n++;
  return store.create({
    id: `t-${n}-${Date.now()}`,
    mailUidValidity: "9",
    mailUid: 1000 + n,
    trame: "confirmer_creneau",
    draft,
  });
};
const T0 = new Date("2026-10-05T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("proposal life cycle", () => {
  it("pending → accepted → sent after the undo delay", async () => {
    const p = await fresh();
    expect(p.status).toBe("pending");
    const accepted = await store.accept(p.id, T0, signedFor(p.draft));
    expect(accepted.sendAfter).toEqual(later(UNDO_DELAY_MS));
    expect(await store.dueForSending(later(UNDO_DELAY_MS - 1))).not.toContainEqual(
      expect.objectContaining({ id: p.id }),
    );
    expect((await store.dueForSending(later(UNDO_DELAY_MS))).map((x) => x.id)).toContain(p.id);
    const claimed = await executor.claim(p.id, later(UNDO_DELAY_MS));
    expect(claimed).toMatchObject({ status: "sending", sentAt: later(UNDO_DELAY_MS) });
    expect((await executor.markSent(p.id, later(UNDO_DELAY_MS + 1000))).status).toBe("sent");
  });

  it("lists the open proposals: pending and accepted, never closed ones", async () => {
    const a = await fresh();
    const b = await fresh();
    const c = await fresh();
    await store.accept(b.id, T0, signedFor(b.draft));
    await store.refuse(c.id, later(9 * 24 * 3600 * 1000));
    const ids = (await store.open()).map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id);
  });

  it("knows which mails already had a proposal", async () => {
    const p = await fresh();
    expect(await store.existsFor(p.mailUidValidity, p.mailUid)).toBe(true);
    expect(await store.existsFor(p.mailUidValidity, 999_999)).toBe(false);
  });

  it("I can edit, then refuse", async () => {
    const p = await fresh();
    expect((await store.edit(p.id, "Bonjour,\n\nC'est noté.")).draft).toBe(
      "Bonjour,\n\nC'est noté.",
    );
    expect((await store.refuse(p.id, T0)).status).toBe("refused");
  });

  it("I can cancel within the undo delay", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    expect((await store.cancel(p.id, later(UNDO_DELAY_MS - 1000))).status).toBe("cancelled");
  });

  it("a proposal lapses when the situation no longer holds", async () => {
    const p = await fresh();
    expect((await store.lapse(p.id, T0)).status).toBe("lapsed");
  });

  it("wipes the text 7 days after closing, keeps the history", async () => {
    const p = await fresh();
    await store.refuse(p.id, T0);
    expect(await store.wipeOldTexts(later(6 * 24 * 3600 * 1000))).toBe(0);
    expect(await store.wipeOldTexts(later(8 * 24 * 3600 * 1000))).toBeGreaterThanOrEqual(1);
    const wiped = await store.get(p.id);
    expect(wiped?.draft).toBeNull();
    expect(wiped?.status).toBe("refused");
  });
});
