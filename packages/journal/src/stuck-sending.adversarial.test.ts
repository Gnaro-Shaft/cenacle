// A sending cut off (lot F1, 13/11), in the real database: stuckSending finds
// only what was claimed before the instant and is still open, and only the
// executor's role may close it as failed.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createProposalStore } from "./proposal-store.ts";
import { appConnection, executorConnection } from "./test-db.ts";

const sql = appConnection();
const execSql = executorConnection();
const store = createProposalStore(sql);
const executor = createProposalStore(execSql);
afterAll(async () => {
  await sql.end();
  await execSql.end();
});

const T0 = new Date("2026-10-05T10:00:00Z");
const draft = "Bonjour,\n\nC'est noté.";
const signed = {
  signature: "s".repeat(86),
  draftHash: createHash("sha256").update(draft, "utf8").digest("hex"),
};
let n = 0;
async function claimedAt(at: Date) {
  n++;
  const p = await store.create({
    id: `stuck-${n}-${Date.now()}`,
    mailUidValidity: "8",
    mailUid: 9000 + n,
    trame: null,
    draft,
  });
  await store.accept(p.id, T0, signed);
  await executor.claim(p.id, at);
  return p.id;
}

describe("stuckSending", () => {
  it("finds a sending claimed before the instant, not one claimed after, nor a closed one", async () => {
    const old = await claimedAt(new Date(T0.getTime() + 5 * 60_000));
    const recent = await claimedAt(new Date(T0.getTime() + 40 * 60_000));
    const closed = await claimedAt(new Date(T0.getTime() + 5 * 60_000));
    await executor.markSent(closed, new Date(T0.getTime() + 6 * 60_000));
    const found = (await store.stuckSending(new Date(T0.getTime() + 30 * 60_000))).map((p) => p.id);
    expect(found).toContain(old);
    expect(found).not.toContain(recent);
    expect(found).not.toContain(closed);
  });

  it("closing it as failed is the executor's alone; then it is found no more", async () => {
    const id = await claimedAt(new Date(T0.getTime() + 5 * 60_000));
    await expect(store.markFailed(id, new Date())).rejects.toThrow();
    await executor.markFailed(id, new Date());
    const found = await store.stuckSending(new Date(T0.getTime() + 30 * 60_000));
    expect(found.map((p) => p.id)).not.toContain(id);
    expect((await store.get(id))?.status).toBe("failed");
  });
});
