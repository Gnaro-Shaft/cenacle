// What reaches the journal: counts and states only, never what the mails say.
import { projectStatus } from "@cenacle/core";
import type { Journal, NewEvent, StoredEvent } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { collectMail } from "./collect.ts";
import type { FetchResult } from "./postman.ts";

function memoryJournal(): Journal & { events: StoredEvent[] } {
  const events: StoredEvent[] = [];
  return {
    events,
    async append(event: NewEvent) {
      const stored = {
        id: BigInt(events.length + 1),
        occurredAt: new Date(),
        agent: event.agent,
        type: event.type,
        payload: event.payload ?? {},
      };
      events.push(stored);
      return stored;
    },
    async read() {
      return [...events];
    },
  };
}

const result: FetchResult = {
  refs: [
    { uid: 1, domain: "client.example" },
    { uid: 2, domain: "client.example" },
    { uid: 3, domain: null },
  ],
  available: 5,
  truncated: true,
  lastUid: 3,
  unseen: 5,
};

describe("collectMail", () => {
  it("shows Iris working, then resting, and journals counts only", async () => {
    const journal = memoryJournal();
    let t = 0;
    const summary = await collectMail({ journal, fetch: async () => result, now: () => (t += 40) });
    expect(summary).toEqual({
      count: 3,
      domains: 2,
      truncated: true,
      lastUid: 3,
      unseen: 5,
      durationMs: 40,
    });
    expect(journal.events.map((e) => [e.type, e.payload])).toEqual([
      ["state.changed", { to: "reading" }],
      ["mail.fetched", { count: 3, truncated: true, durationMs: 40 }],
      ["state.changed", { to: "idle" }],
    ]);
    expect(JSON.stringify(journal.events.map((e) => e.payload))).not.toMatch(
      /client\.example|"uid"/,
    );
    expect(projectStatus("iris", journal.events).view.visual).toBe("resting");
  });

  it("turns Iris sick on failure, journals the error name without its message, and rethrows", async () => {
    const journal = memoryJournal();
    const leak = new Error("NO [AUTH] secret-password rejected for boss@client.example");
    await expect(
      collectMail({
        journal,
        fetch: async () => {
          throw leak;
        },
      }),
    ).rejects.toBe(leak);
    expect(journal.events.map((e) => [e.type, e.payload])).toEqual([
      ["state.changed", { to: "reading" }],
      ["mail.fetch_failed", { reason: "Error" }],
      ["state.changed", { to: "error" }],
    ]);
    expect(JSON.stringify(journal.events.map((e) => e.payload))).not.toMatch(
      /secret|client\.example/,
    );
    expect(projectStatus("iris", journal.events).view.visual).toBe("sick");
  });
});
