// Iris's daily purge (C1): once a day, the retentions of cadre.toml, exactly;
// a failure is said and does not stop her rhythm.
import type { Purges } from "@cenacle/journal";
import type { Conservation } from "@cenacle/mail";
import { memoryJournal, memoryMailStore } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { purgeDue } from "./purge.ts";
import { tick } from "./tick.ts";

const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-11-02T10:00:00+01:00");
const C: Conservation = {
  memoireJours: 90,
  texteBrouillonJours: 7,
  propositionsJours: 90,
  journalJours: 180,
  oppositionJours: 1095,
};

function world(fail = false) {
  const journal = memoryJournal();
  const calls: string[] = [];
  let now = NOW;
  const purges: Purges = {
    proposals: async (cutoff) => {
      calls.push(`proposals<${cutoff.toISOString()}`);
      return 2;
    },
    events: async (cutoff) => {
      if (fail) throw new Error("connect ECONNREFUSED 127.0.0.1:55432");
      calls.push(`events<${cutoff.toISOString()}`);
      return 5;
    },
    opposition: async (cutoff) => {
      calls.push(`opposition<${cutoff.toISOString()}`);
      return 3;
    },
  };
  const deps = {
    now: () => now,
    journal,
    events: async () => journal.events.filter((e) => e.agent === "iris"),
    conservation: C,
    wipeTexts: async (at: Date, days: number) => {
      calls.push(`texts ${days}d at ${at.toISOString()}`);
      return 1;
    },
    purges,
  };
  return {
    deps,
    journal,
    calls,
    at: (d: Date) => {
      now = d;
    },
  };
}

describe("purgeDue", () => {
  it("applies each retention of cadre.toml, and journals counts only", async () => {
    const w = world();
    expect(await purgeDue(w.deps)).toEqual({ texts: 1, proposals: 2, events: 5, opposition: 3 });
    expect(w.calls).toEqual([
      `texts 7d at ${NOW.toISOString()}`,
      `proposals<${new Date(NOW.getTime() - 90 * DAY).toISOString()}`,
      `events<${new Date(NOW.getTime() - 180 * DAY).toISOString()}`,
      `opposition<${new Date(NOW.getTime() - 1095 * DAY).toISOString()}`,
    ]);
    expect(w.journal.events.at(-1)).toMatchObject({
      type: "purge.done",
      payload: { texts: 1, proposals: 2, events: 5, opposition: 3 },
    });
  });

  it("once a day: not again within 24 hours, again after", async () => {
    const w = world();
    await purgeDue(w.deps);
    // The memory journal stamps events with the real clock: date the run at NOW.
    const done = w.journal.events.at(-1);
    if (done !== undefined) (done as { occurredAt: Date }).occurredAt = NOW;
    w.at(new Date(NOW.getTime() + DAY - 1000));
    expect(await purgeDue(w.deps)).toBeNull();
    w.at(new Date(NOW.getTime() + DAY));
    expect(await purgeDue(w.deps)).not.toBeNull();
  });

  it("a failure is journaled by its name only, and thrown", async () => {
    const w = world(true);
    await expect(purgeDue(w.deps)).rejects.toThrow();
    const failed = w.journal.events.at(-1);
    expect(failed).toMatchObject({ type: "purge.failed", payload: { reason: "Error" } });
    expect(JSON.stringify(failed?.payload)).not.toContain("127.0.0.1");
    expect(w.journal.events.some((e) => e.type === "purge.done")).toBe(false);
  });

  it("a failing purge does not stop Iris's beat", async () => {
    const journal = memoryJournal();
    const outcome = await tick({
      now: () => NOW,
      startedAt: NOW,
      journal,
      store: memoryMailStore(),
      events: async (agent) => journal.events.filter((e) => e.agent === agent),
      runPass: async () => {},
      totals: async () => ({ waiting: 0, due: 0 }),
      send: async () => {},
      purge: async () => {
        throw new Error("purge down");
      },
    });
    expect(outcome).toBe("done");
  });
});
