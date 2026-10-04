// Purges that really erase (C1), and nothing else: the application role still
// cannot delete by itself, open proposals and recent events survive, and every
// purge says how many it erased — never what.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createJournal } from "./journal.ts";
import { createProposalStore } from "./proposal-store.ts";
import { createPurges } from "./purges.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const store = createProposalStore(sql);
const purges = createPurges(sql);
const journal = createJournal(sql);
afterAll(() => sql.end());

const OLD = new Date("2020-03-02T10:00:00Z");
const CUTOFF = new Date("2021-01-01T00:00:00Z");
let n = 0;
const fresh = async () => {
  n++;
  return store.create({
    id: `purge-${n}-${Date.now()}`,
    mailUidValidity: "7",
    mailUid: 7000 + n,
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
const lastOfType = async (type: string) =>
  (await journal.read({ agent: "cenacle", limit: 1000 })).findLast((e) => e.type === type);

describe("the application role still cannot delete by itself", () => {
  it("neither proposals nor events, even with the purge flag set", async () => {
    const p = await fresh();
    await expect(sql`delete from proposals where id = ${p.id}`).rejects.toThrow(/permission/);
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('cenacle.purging_events', 'on', true)`;
        await tx`delete from events where agent = 'iris'`;
      }),
    ).rejects.toThrow(/permission|append-only/);
    await expect(sql`truncate events`).rejects.toThrow();
  });

  it("a cutoff in the future is refused: a purge cannot erase what is still due", async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    await expect(purges.proposals(tomorrow)).rejects.toThrow(/future/);
    await expect(purges.events(tomorrow)).rejects.toThrow(/future/);
  });
});

describe("purge_proposals", () => {
  it("erases closed proposals closed before the cutoff, never open ones, and says how many", async () => {
    const oldRefused = await fresh();
    await store.refuse(oldRefused.id, OLD);
    const oldPending = await fresh(); // created now, never decided: open
    const oldAccepted = await fresh();
    await store.accept(oldAccepted.id, OLD, signed(oldAccepted.draft));
    const recentRefused = await fresh();
    await store.refuse(recentRefused.id, new Date());

    const erased = await purges.proposals(CUTOFF);
    expect(erased).toBeGreaterThanOrEqual(1);
    expect(await store.get(oldRefused.id)).toBeNull();
    expect((await store.get(oldPending.id))?.status).toBe("pending");
    expect((await store.get(oldAccepted.id))?.status).toBe("accepted");
    expect((await store.get(recentRefused.id))?.status).toBe("refused");
    const event = await lastOfType("proposals.purged");
    expect(event?.payload).toMatchObject({ count: erased });
    expect(JSON.stringify(event?.payload)).not.toContain(oldRefused.id);
  });
});

describe("purge_events", () => {
  it("erases events older than the cutoff, keeps the recent ones, and leaves a trace", async () => {
    await sql`insert into events (agent, type, occurred_at, payload)
              values ('purgetest', 'old.one', ${OLD}, '{}'), ('purgetest', 'old.two', ${OLD}, '{}')`;
    const recent = await journal.append({ agent: "purgetest", type: "recent.one" });

    const erased = await purges.events(CUTOFF);
    expect(erased).toBeGreaterThanOrEqual(2);
    const left = await journal.read({ agent: "purgetest", limit: 1000 });
    expect(left.map((e) => e.type)).toEqual(["recent.one"]);
    expect(left[0]?.id).toBe(recent.id);
    const trace = await lastOfType("journal.purged");
    expect(trace?.payload).toMatchObject({ count: erased });
  });

  it("a proposal's creation goes only with its closing: no closing is ever left orphan", async () => {
    const RECENT = new Date();
    const ev = (type: string, id: string, at: Date) =>
      sql`insert into events (agent, type, occurred_at, payload)
          values ('purgebubble', ${type}, ${at}, ${sql.json({ proposalId: id, outcome: "lapsed" })})`;
    await ev("proposal.created", "both-old", OLD);
    await ev("proposal.closed", "both-old", OLD);
    await ev("proposal.created", "closed-late", OLD); // closed after the cutoff: keeps its creation
    await ev("proposal.closed", "closed-late", RECENT);
    await ev("proposal.created", "still-open", OLD); // never closed: keeps its creation

    await purges.events(CUTOFF);
    const left = (await journal.read({ agent: "purgebubble", limit: 1000 })).map(
      (e) => `${e.type}:${String(e.payload.proposalId)}`,
    );
    expect(left).toEqual([
      "proposal.created:closed-late",
      "proposal.closed:closed-late",
      "proposal.created:still-open",
    ]);
    // What the projection needs (core/agent-status.ts): every closing has its creation.
    const created = new Set(
      left.filter((l) => l.startsWith("proposal.created")).map((l) => l.split(":")[1]),
    );
    for (const l of left.filter((x) => x.startsWith("proposal.closed"))) {
      expect(created.has(l.split(":")[1])).toBe(true);
    }
  });

  it("after a purge, the journal is append-only again", async () => {
    await purges.events(CUTOFF);
    await expect(sql`delete from events where agent = 'purgetest'`).rejects.toThrow();
    await expect(sql`update events set type = 'x' where agent = 'purgetest'`).rejects.toThrow();
  });
});
