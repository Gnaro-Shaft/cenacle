// What the executor no longer sends, or no longer leaves open (lot F1, 13/11):
// an acceptance older than 24 h lapses, never sent; a sending cut off before
// the mail server answered is closed as failed after 15 min — whether it left
// is unknown, so it is never sent again, and I check my Sent folder.
import { describe, expect, it } from "vitest";
import { executeDue, MAX_ACCEPTANCE_AGE_MS, STUCK_SENDING_MS } from "./execute.ts";
import { T0, world } from "./test-executor-world.ts";

const at = (ms: number) => new Date(T0.getTime() + ms);

describe("an acceptance too old to send", () => {
  it("accepted 24 h and 1 s ago: lapsed as too old, never sent", async () => {
    const w = world();
    const id = await w.accepted();
    w.at(at(MAX_ACCEPTANCE_AGE_MS + 1000));
    const r = await executeDue(w.deps);
    expect(r.lapsed).toEqual([{ id, reason: "too_old" }]);
    expect(r.sent).toEqual([]);
    expect(w.outbox).toEqual([]);
    expect((await w.store.get(id))?.status).toBe("lapsed");
  });

  it("accepted 23 h ago (a sleeping night): still sent", async () => {
    const w = world();
    const id = await w.accepted();
    w.at(at(23 * 3_600_000));
    expect((await executeDue(w.deps)).sent).toEqual([id]);
  });

  it("an unsigned old acceptance is refused as unsigned first, not hidden as too old", async () => {
    const w = world();
    const id = await w.accepted();
    w.deps = { ...w.deps, verify: () => false } as typeof w.deps;
    w.at(at(MAX_ACCEPTANCE_AGE_MS * 3));
    const r = await executeDue(w.deps);
    expect(r.unsigned).toEqual([id]);
    expect(r.lapsed).toEqual([]);
  });
});

describe("a sending cut off", () => {
  async function stuck() {
    const w = world();
    const id = await w.accepted();
    w.at(at(120_000));
    await w.store.claim(id, at(120_000));
    return { w, id };
  }

  it("claimed 15 min and 1 s ago, never closed: failed, journaled, never sent again", async () => {
    const { w, id } = await stuck();
    w.at(at(120_000 + STUCK_SENDING_MS + 1000));
    const r = await executeDue(w.deps);
    expect(r.interrupted).toEqual([id]);
    expect((await w.store.get(id))?.status).toBe("failed");
    expect(w.outbox).toEqual([]);
    expect(w.journal.events.at(-1)).toMatchObject({
      type: "send.failed",
      payload: { proposalId: id, reason: "interrupted" },
    });
    // The next round leaves it closed.
    expect((await executeDue(w.deps)).interrupted).toEqual([]);
  });

  it("claimed 14 min ago: left alone, it may still be sending", async () => {
    const { w, id } = await stuck();
    w.at(at(120_000 + 14 * 60_000));
    expect((await executeDue(w.deps)).interrupted).toEqual([]);
    expect((await w.store.get(id))?.status).toBe("sending");
  });

  it("the journal holds the id and the reason, never the text", async () => {
    const { w } = await stuck();
    w.at(at(120_000 + STUCK_SENDING_MS + 1000));
    await executeDue(w.deps);
    expect(JSON.stringify(w.journal.events.map((e) => e.payload))).not.toContain("650");
  });
});
