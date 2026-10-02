// What a pass remembers and journals: keys and counts, never content; only
// what is new; and nothing older than the retention period.
import { projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { type CollectDeps, collectMail } from "./collect.ts";
import type { FetchResult, MailRef, SentRef } from "./postman.ts";
import { parseRules } from "./rules.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";

const K = (c: string) => c.repeat(64);
const NOW = new Date("2026-10-01T08:00:00Z");
const ref = (
  uid: number,
  domain: string | null,
  receivedAt = "2026-09-30T08:00:00.000Z",
): MailRef => ({
  uid,
  domain,
  senderKey: K("a"),
  messageKey: K(String(uid)),
  threadKeys: [],
  receivedAt,
});
const result = <T>(refs: T[], uidValidity = "1"): FetchResult<T> => ({
  refs,
  uidValidity,
  available: refs.length,
  truncated: false,
  lastUid: null,
  unseen: refs.length,
});
const rules = parseRules('[clients_prospects]\ndomains = ["client.example"]\n');

function setup(inbox: (afterUid: number) => MailRef[], sent: SentRef[] = [], validity = () => "1") {
  const journal = memoryJournal();
  const store = memoryMailStore();
  const asked: number[] = [];
  const deps: CollectDeps = {
    journal,
    store,
    rules,
    clock: () => NOW,
    fetchInbox: async (afterUid) => {
      asked.push(afterUid);
      return result(inbox(afterUid), validity());
    },
    fetchSent: async (afterUid) => result(sent.filter((s) => s.uid > afterUid)),
  };
  return { journal, store, deps, asked };
}

describe("collectMail", () => {
  it("remembers keys only, sorts by rules, and journals counts — never a domain or a key", async () => {
    const { journal, store, deps } = setup(() => [
      ref(1, "client.example"),
      ref(2, "other.example"),
      ref(3, null),
    ]);
    const summary = await collectMail(deps);
    expect(summary.count).toBe(3);
    expect(summary.uncategorized).toEqual([2]);
    const stored = JSON.stringify(await store.inbox());
    expect(stored).not.toMatch(/client\.example|other\.example/);
    const payloads = JSON.stringify(journal.events.map((e) => e.payload));
    expect(payloads).not.toMatch(/example|"uid"|aaaa/);
    expect(journal.events.map((e) => e.type)).toEqual([
      "state.changed",
      "mail.fetched",
      "mail.sorted_by_rules",
      "mail.totals",
      "state.changed",
    ]);
    expect(projectStatus("iris", journal.events).mail).toEqual({
      clients_prospects: 1,
      administratif: 0,
      bruit: 0,
      a_trier: 1,
      pending: 1,
    });
  });

  it("a second pass asks only for what is new", async () => {
    const all = [ref(1, "client.example"), ref(2, "client.example")];
    const { deps, asked } = setup((after) => all.filter((r) => r.uid > after));
    await collectMail(deps);
    all.push(ref(3, "client.example"));
    const second = await collectMail(deps);
    expect(asked).toEqual([0, 2]);
    expect(second.count).toBe(1);
  });

  it("forgets a mailbox the server renumbered, and reads it again from the start", async () => {
    let validity = "1";
    const { deps, store, asked } = setup(
      (after) => [ref(1, "client.example"), ref(2, "x.example")].filter((r) => r.uid > after),
      [],
      () => validity,
    );
    await collectMail(deps);
    validity = "2";
    const second = await collectMail(deps);
    expect(asked).toEqual([0, 2, 0]);
    expect(second.purged).toBe(2);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([1, 2]);
  });

  it("forgets mails older than 90 days", async () => {
    const { deps, store } = setup(() => [
      ref(1, "client.example", "2026-06-01T00:00:00.000Z"),
      ref(2, "client.example"),
    ]);
    const summary = await collectMail(deps);
    expect(summary.purged).toBe(1);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([2]);
  });

  it("turns Iris sick on failure, journals the error name without its message, and rethrows", async () => {
    const { journal, deps } = setup(() => []);
    const leak = new Error("NO [AUTH] secret-password rejected for boss@client.example");
    await expect(
      collectMail({
        ...deps,
        fetchInbox: async () => {
          throw leak;
        },
      }),
    ).rejects.toBe(leak);
    expect(journal.events.map((e) => [e.type, e.payload])).toEqual([
      ["state.changed", { to: "reading" }],
      ["mail.fetch_failed", { reason: "Error" }],
      ["state.changed", { to: "error" }],
    ]);
    expect(projectStatus("iris", journal.events).view.visual).toBe("sick");
  });
});
