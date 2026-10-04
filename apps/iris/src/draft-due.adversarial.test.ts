// A proposal whose mail is gone (renumbered mailbox, mail deleted) cannot be
// accepted: it is closed as lapsed, never left stuck on the page.
import type { TrameVote } from "@cenacle/brain";
import { createProposals, EXAMPLE_TRAMES_PATH, loadTrames } from "@cenacle/mail";
import {
  memoryJournal,
  memoryMailStore,
  memoryProposalStore,
  signedNow,
} from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { type DraftDueDeps, lapseOrphans } from "./draft-due.ts";

const K = (c: string) => c.repeat(64);

async function setup() {
  const mails = memoryMailStore();
  await mails.saveInbox("9", [
    {
      uid: 1,
      receivedAt: "2026-10-01T08:00:00Z",
      noFollowUp: false,
      urgentTerm: false,
      senderKey: K("a"),
      messageKey: K("b"),
      threadKeys: [],
    },
  ]);
  const store = memoryProposalStore();
  const journal = memoryJournal();
  const deps: DraftDueDeps = {
    mails,
    store,
    read: async () => [],
    trames: loadTrames({ local: "/nonexistent/x.toml", example: EXAMPLE_TRAMES_PATH }),
    proposals: createProposals(store, journal),
    vote: async (): Promise<TrameVote> => ({ choice: null, votes: {}, rounds: 0, needed: 5 }),
    copySlots: async () => ({}),
    newId: () => "p-x",
    now: () => new Date("2026-10-05T10:00:00Z"),
  };
  const add = (id: string, validity: string, uid: number) =>
    store.create({ id, mailUidValidity: validity, mailUid: uid, trame: null, draft: "Bonjour" });
  return { deps, store, journal, add };
}

describe("lapseOrphans", () => {
  it("closes proposals of a renumbered mailbox or of a vanished mail; keeps the others", async () => {
    const { deps, store, journal, add } = await setup();
    await add("p-here", "9", 1);
    await add("p-old", "8", 1);
    await add("p-gone", "9", 42);
    expect(await lapseOrphans(deps)).toBe(2);
    expect((await store.get("p-here"))?.status).toBe("pending");
    expect((await store.get("p-old"))?.status).toBe("lapsed");
    expect((await store.get("p-gone"))?.status).toBe("lapsed");
    // The bubble follows: each one leaves it through the journal.
    expect(
      journal.events.filter((e) => e.type === "proposal.closed").map((e) => e.payload),
    ).toEqual([
      { proposalId: "p-old", outcome: "lapsed" },
      { proposalId: "p-gone", outcome: "lapsed" },
    ]);
  });

  it("leaves alone a mail being sent or a failed send", async () => {
    const { deps, store, add } = await setup();
    await add("p-sending", "8", 1);
    const at = new Date("2026-10-05T09:00:00Z");
    await store.accept("p-sending", at, await signedNow(store, "p-sending", at));
    await store.claim("p-sending", new Date("2026-10-05T09:05:00Z"));
    expect(await lapseOrphans(deps)).toBe(0);
    expect((await store.get("p-sending"))?.status).toBe("sending");
  });

  it("an accepted proposal whose mail vanished is called off too (never sent)", async () => {
    const { deps, store, journal, add } = await setup();
    await add("p-acc", "8", 1);
    const at = new Date("2026-10-05T09:59:00Z");
    await store.accept("p-acc", at, await signedNow(store, "p-acc", at));
    expect(await lapseOrphans(deps)).toBe(1);
    expect((await store.get("p-acc"))?.status).toBe("lapsed");
    expect(journal.events.map((e) => e.type)).toContain("send.lapsed");
  });
});
