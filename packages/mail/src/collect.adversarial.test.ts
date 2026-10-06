// What a pass remembers and journals: keys and counts, never content; only
// what is new; and nothing older than the retention period.
import { projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { type CollectDeps, collectMail } from "./collect.ts";
import type { FetchResult, MailRef, SentRef } from "./postman.ts";
import { parseRules } from "./rules.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { oneFolder } from "./test-locations.ts";

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
  urgentTerm: false,
  auth: "authenticated",
});
const result = <T extends { uid: number }>(
  refs: T[],
  uidValidity = "1",
  present?: number[],
): FetchResult<T> => ({
  refs,
  uidValidity,
  present: present ?? refs.map((r) => r.uid),
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
    retentionDays: 90,
    opposedKeys: new Set(),
    notBefore: null,
    clock: () => NOW,
    ...oneFolder(async (afterUid) => {
      asked.push(afterUid);
      return result(
        inbox(afterUid),
        validity(),
        inbox(0).map((r) => r.uid),
      );
    }),
    fetchSent: async (afterUid) =>
      result(
        sent.filter((s) => s.uid > afterUid),
        "1",
        sent.map((s) => s.uid),
      ),
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
      "mail.sender_auth",
      "mail.totals",
      "state.changed",
    ]);
    expect(projectStatus("iris", journal.events).mail).toEqual({
      clients_prospects: 1,
      administratif: 0,
      bruit: 0,
      a_trier: 1,
      pending: 1,
      waiting: 1, // the client mail is 24 working hours old, no reply sent
      due: 0,
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

  it("a folder the server renumbered is read again from the start; its mails are found again, not forgotten (ADR-0016)", async () => {
    let validity = "1";
    const { deps, store, asked } = setup(
      (after) => [ref(1, "client.example"), ref(2, "x.example")].filter((r) => r.uid > after),
      [],
      () => validity,
    );
    await collectMail(deps);
    const before = (await store.inbox()).map((i) => [i.uid, i.category]);
    validity = "2";
    const second = await collectMail(deps);
    expect(asked).toEqual([0, 2, 0]);
    expect(second.purged).toBe(0);
    expect(second.count).toBe(0);
    expect((await store.inbox()).map((i) => [i.uid, i.category])).toEqual(before);
    const places = await deps.locations.all();
    expect(places.map((l) => l.uidValidity)).toEqual(["2", "2"]);
  });

  it("flags mails from a [sans_suivi] domain, without storing the domain", async () => {
    const { deps, store } = setup(() => [ref(1, "client.example"), ref(2, "platform.example")]);
    await collectMail({ ...deps, noFollowUp: new Set(["platform.example"]) });
    expect((await store.inbox()).map((i) => [i.uid, i.noFollowUp])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("forgets a mail deleted or moved on the server", async () => {
    const all = [ref(1, "client.example"), ref(2, "client.example")];
    const { deps, store } = setup((after) => all.filter((r) => r.uid > after));
    await collectMail(deps);
    all.splice(0, 1);
    const second = await collectMail(deps);
    expect(second.purged).toBe(1);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([2]);
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
        ...oneFolder(async () => {
          throw leak;
        }),
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

describe("the opposition list (C3)", () => {
  const opposedRef = (uid: number): MailRef => ({
    ...ref(uid, "client.example"),
    senderKey: K("b"),
  });
  const sentTo = (uid: number, recipientKeys: string[]): SentRef => ({
    uid,
    sentAt: "2026-09-30T09:00:00.000Z",
    recipientKeys,
    messageKey: K("c"),
    threadKeys: [],
  });

  it("an opposed person's mails are never remembered nor sorted, even after a renumbering", async () => {
    let validity = "1";
    const { deps, store } = setup(
      (after) => [ref(1, "client.example"), opposedRef(2)].filter((r) => r.uid > after),
      [sentTo(1, [K("a"), K("b")])],
      () => validity,
    );
    const withList = { ...deps, opposedKeys: new Set([K("b")]) };
    const first = await collectMail(withList);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([1]);
    expect(first.ruleSort.counts.clients_prospects).toBe(1);
    // In my sent mail to both, only their key leaves: the other recipient stays.
    expect((await store.sent()).map((s) => s.recipientKeys)).toEqual([[K("a")]]);
    validity = "2"; // the server renumbers: everything is read again from the start
    await collectMail(withList);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([1]);
    expect(JSON.stringify(await store.inbox())).not.toContain(K("b"));
  });
});

describe("nothing from before the information notice (C4)", () => {
  it("received and sent mails dated before the notice are not read; the rest is", async () => {
    const { deps, store } = setup(
      () => [
        ref(1, "client.example", "2026-09-29T21:59:59.000Z"),
        ref(2, "client.example", "2026-09-29T22:00:00.000Z"),
      ],
      [
        {
          uid: 1,
          sentAt: "2026-09-29T08:00:00.000Z",
          recipientKeys: [K("a")],
          messageKey: K("c"),
          threadKeys: [],
        },
        {
          uid: 2,
          sentAt: "2026-09-30T08:00:00.000Z",
          recipientKeys: [K("a")],
          messageKey: K("d"),
          threadKeys: [],
        },
      ],
    );
    // Notice published on 30 September: from midnight, Paris time (22:00 UTC the day before).
    const summary = await collectMail({ ...deps, notBefore: new Date("2026-09-29T22:00:00.000Z") });
    // Iris's own ids (ADR-0016): which mail was kept is told by its arrival time.
    expect((await store.inbox()).map((i) => i.receivedAt)).toEqual(["2026-09-29T22:00:00.000Z"]);
    expect((await store.sent()).map((s) => s.uid)).toEqual([2]);
    expect(summary.count).toBe(1);
  });

  it("no limit for the fictional test mailbox", async () => {
    const { deps, store } = setup(() => [ref(1, "client.example", "2020-01-01T00:00:00.000Z")]);
    await collectMail({ ...deps, retentionDays: 10_000, notBefore: null });
    expect((await store.inbox()).map((i) => i.uid)).toEqual([1]);
  });
});
