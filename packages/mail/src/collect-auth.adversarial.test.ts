// ADR-0014 through a whole pass: a forged From with a client's domain is not
// a client — no "clients" box, no model, no follow-up, no urgent alert — and
// losing the evidence altogether shows on Iris, not only in a count.
import { projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { authCounts, type CollectDeps, collectMail, mailTotals } from "./collect.ts";
import type { FetchResult, MailRef } from "./postman.ts";
import { parseRules } from "./rules.ts";
import type { AuthVerdict } from "./sender-auth.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { oneFolder } from "./test-locations.ts";

const K = (c: string) => c.repeat(64);
const NOW = new Date("2026-10-01T08:00:00Z");
const ref = (uid: number, auth: AuthVerdict, domain = "client.example"): MailRef => ({
  uid,
  domain,
  senderKey: K("a"),
  messageKey: K(String(uid)),
  threadKeys: [],
  receivedAt: "2026-09-29T08:00:00.000Z", // 48 working hours ago: due if followed
  urgentTerm: true,
  auth,
});
const result = <T extends { uid: number }>(refs: T[]): FetchResult<T> => ({
  refs,
  uidValidity: "1",
  present: refs.map((r) => r.uid),
  available: refs.length,
  truncated: false,
  lastUid: null,
  unseen: refs.length,
});
const rules = parseRules(
  '[clients_prospects]\ndomains = ["client.example"]\n[bruit]\ndomains = ["news.example"]\n',
);

function setup(passes: MailRef[][]) {
  const journal = memoryJournal();
  const store = memoryMailStore();
  let pass = 0;
  const deps: CollectDeps = {
    journal,
    store,
    rules,
    retentionDays: 90,
    opposedKeys: new Set(),
    notBefore: null,
    clock: () => NOW,
    ...oneFolder(async (afterUid) =>
      result(
        passes
          .slice(0, ++pass)
          .flat()
          .filter((r) => r.uid > afterUid),
      ),
    ),
    fetchSent: async () => result([]),
  };
  return { journal, store, deps };
}

describe("collectMail — sender authentication", () => {
  it("a forged client: À trier, never the model, never followed, never alerted", async () => {
    const { store, deps } = setup([[ref(1, "authenticated"), ref(2, "failed")]]);
    const summary = await collectMail(deps);
    expect(summary.ruleSort.unauthenticated).toBe(1);
    expect(summary.uncategorized).toEqual([]); // not left for the model
    const rows = await store.inbox();
    expect(rows.map((r) => [r.uid, r.category, r.decidedBy, r.senderAuthenticated])).toEqual([
      [1, "clients_prospects", "rule", true],
      [2, "a_trier", "unauthenticated", false],
    ]);
    expect(await store.urgentToNotify(new Date(0))).toEqual([1]);
    expect((await mailTotals(store, NOW)).due).toBe(1); // the authenticated client only
  });

  it.each(["missing", "duplicated", "misplaced", "unreadable", "failed"] as const)(
    "a client domain with a `%s` verdict is refused",
    async (auth) => {
      const { store, deps } = setup([[ref(1, auth)]]);
      await collectMail(deps);
      const [row] = await store.inbox();
      expect(row).toMatchObject({ category: "a_trier", decidedBy: "unauthenticated" });
      expect(await store.urgentToNotify(new Date(0))).toEqual([]);
    },
  );

  it("other rules still apply to an unauthenticated sender (noise stays noise)", async () => {
    const { store, deps } = setup([[ref(1, "missing", "news.example")]]);
    await collectMail(deps);
    expect((await store.inbox())[0]).toMatchObject({ category: "bruit", decidedBy: "rule" });
  });

  it("journals counts only — never a domain, a key or a UID", async () => {
    const { journal, deps } = setup([[ref(1, "authenticated"), ref(2, "duplicated")]]);
    await collectMail(deps);
    const event = journal.events.find((e) => e.type === "mail.sender_auth");
    expect(event?.payload).toEqual({
      mails: 2,
      trusted: 1,
      authenticated: 1,
      missing: 0,
      duplicated: 1,
      misplaced: 0,
      unreadable: 0,
      failed: 0,
    });
    expect(JSON.stringify(event?.payload)).not.toMatch(/example|aaaa|"uid"/);
  });

  it("no new mail: no authentication event, the status is left as it was", async () => {
    const { journal, deps } = setup([[]]);
    await collectMail(deps);
    expect(journal.events.some((e) => e.type === "mail.sender_auth")).toBe(false);
  });

  it("a pass where no mail carries our server's header shows Iris sick, until one does", async () => {
    const { journal, deps } = setup([
      [ref(1, "missing"), ref(2, "misplaced")],
      [ref(3, "authenticated")],
    ]);
    await collectMail(deps);
    expect(projectStatus("iris", journal.events).view).toEqual({
      visual: "sick",
      note: "auth_missing",
    });
    await collectMail(deps);
    const healed = projectStatus("iris", journal.events);
    expect(healed.authMissing).toBe(false);
    expect(healed.view.visual).not.toBe("sick");
  });

  it("a failed check is not a lost header: forged mails alone do not make Iris sick", async () => {
    const { journal, deps } = setup([[ref(1, "failed")]]);
    await collectMail(deps);
    expect(projectStatus("iris", journal.events).authMissing).toBe(false);
  });
});

describe("authCounts", () => {
  it("counts every verdict, and trusted = authenticated + failed", () => {
    const refs = (["authenticated", "failed", "missing", "missing"] as const).map((auth) => ({
      auth,
    }));
    expect(authCounts(refs)).toMatchObject({ mails: 4, trusted: 2, missing: 2 });
  });
});
