// The validation page: the recipient comes from the server (the sender, never
// the Reply-To), red flags are computed, and nothing is accepted without a
// readable recipient or with a slot left.
import type { MailForModel } from "@cenacle/core";
import { createProposals, EXAMPLE_TRAMES_PATH, loadTrames, type ReplyTarget } from "@cenacle/mail";
import { memoryJournal, memoryProposalStore, TEST_KEYS } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { cleanDraft, createProposalsService } from "./proposals-service.ts";

const TRAMES = loadTrames({ local: "/nonexistent/x.toml", example: EXAMPLE_TRAMES_PATH });
const MAIL: MailForModel = {
  uid: 7,
  fromName: "Claire Dubois",
  domain: "client.example",
  subject: "Point jeudi ?",
  text: "Bonjour, seriez-vous disponible jeudi à 14 h ?",
};

function setup(
  target: ReplyTarget | undefined,
  validity = "8",
  undoMs = 2 * 60_000,
  sending: "none" | "test-domains" | "closed" | "correspondents" = "test-domains",
) {
  const store = memoryProposalStore();
  const journal = memoryJournal();
  const service = createProposalsService({
    store,
    proposals: createProposals(store, journal),
    uidValidity: async () => validity,
    readMails: async (uids) => (uids.includes(7) ? [MAIL] : []),
    readTargets: async () => new Map(target === undefined ? [] : [[7, target]]),
    trames: TRAMES,
    now: () => new Date("2026-10-05T10:00:00Z"),
    sign: TEST_KEYS.signed,
    undoMs,
    sending,
  });
  const propose = (draft: string) =>
    store.create({
      id: "p-1",
      mailUidValidity: "8",
      mailUid: 7,
      trame: "confirmer_creneau",
      draft,
    });
  return { store, service, propose, journal };
}

const SIGNED = `Bonjour Claire,\n\nJeudi à 14 h me convient très bien. À bientôt.\n\n${TRAMES.signature}`;

describe("the page's view", () => {
  it("shows the sender as the only recipient, and no red flag on a clean draft", async () => {
    const { service, propose } = setup({
      uid: 7,
      to: "claire@client.example",
      replyToElsewhere: false,
    });
    await propose(SIGNED);
    const [v] = await service.list();
    expect(v?.mail).toEqual({
      subject: "Point jeudi ?",
      fromName: "Claire Dubois",
      to: "claire@client.example",
      replyToElsewhere: false,
    });
    expect(v?.toComplete).toEqual([]);
    expect(v?.unsupported).toEqual([]);
  });

  it("flags a Reply-To elsewhere, slots left, and facts absent from the thread", async () => {
    const { service, propose } = setup({
      uid: 7,
      to: "claire@client.example",
      replyToElsewhere: true,
    });
    await propose(
      "Bonjour Claire,\n\nVendredi à 9 h, pour 3 000 €. Je reviens vers vous {delai ?}.",
    );
    const [v] = await service.list();
    expect(v?.mail?.replyToElsewhere).toBe(true);
    expect(v?.toComplete).toEqual(["delai"]);
    expect(v?.unsupported.length).toBeGreaterThanOrEqual(2);
  });

  it("a mail gone from the server (renumbered mailbox) shows no recipient", async () => {
    const { service, propose } = setup(undefined, "9");
    await propose(SIGNED);
    expect((await service.list())[0]?.mail).toBeNull();
  });
});

describe("accepting", () => {
  it("accepts with a readable recipient and no slot left", async () => {
    const { service, propose, store } = setup({
      uid: 7,
      to: "claire@client.example",
      replyToElsewhere: false,
    });
    await propose(SIGNED);
    await service.accept("p-1", SIGNED);
    const accepted = await store.get("p-1");
    expect(accepted?.status).toBe("accepted");
    // Signed by the page, for this very text: what the executor will check.
    expect(accepted !== null && TEST_KEYS.verify(accepted)).toBe(true);
    expect(accepted?.sendAfter?.toISOString()).toBe("2026-10-05T10:02:00.000Z");
  });

  it("a real box (M3): 10 minutes to change my mind", async () => {
    const target = { uid: 7, to: "claire@client.example", replyToElsewhere: false };
    const { service, propose, store } = setup(target, "8", 10 * 60_000);
    await propose(SIGNED);
    await service.accept("p-1", SIGNED);
    expect((await store.get("p-1"))?.sendAfter?.toISOString()).toBe("2026-10-05T10:10:00.000Z");
  });

  it("an undo delay under 2 minutes is refused, whoever asks", async () => {
    const target = { uid: 7, to: "claire@client.example", replyToElsewhere: false };
    const { service, propose, store } = setup(target, "8", 30_000);
    await propose(SIGNED);
    await expect(service.accept("p-1", SIGNED)).rejects.toThrow(/undo delay/);
    expect((await store.get("p-1"))?.status).toBe("pending");
  });

  it.each([
    ["the sender cannot be read", { uid: 7, to: null, replyToElsewhere: false }, /cannot be read/],
    ["the mail is gone", undefined, /no longer on the server/],
  ])("refuses when %s", async (_label, target, error) => {
    const { service, propose, store } = setup(target as ReplyTarget | undefined);
    await propose(SIGNED);
    await expect(service.accept("p-1", SIGNED)).rejects.toThrow(error);
    expect((await store.get("p-1"))?.status).toBe("pending");
  });

  it("my edit is checked: type, length, control characters", () => {
    expect(cleanDraft("  Bonjour\r\nClaire  ")).toBe("Bonjour\nClaire");
    for (const bad of [42, null, "", "x".repeat(5001), "Bonjour\u0000", "Bcc:\u001bx"]) {
      expect(() => cleanDraft(bad)).toThrow();
    }
  });
});

describe("accepting signs the text I was shown, or nothing (lot B, 13/11)", () => {
  const target = { uid: 7, to: "claire@client.example", replyToElsewhere: false };

  it("a text changed since the page showed it (another tab, the CLI) is not signed", async () => {
    const { service, propose, store, journal } = setup(target);
    await propose(SIGNED);
    const shown = (await service.list())[0]?.draft ?? "";
    const before = journal.events.length;
    await store.edit("p-1", `${SIGNED}\nPS : virement sur le compte FR76…`);
    await expect(service.accept("p-1", shown)).rejects.toThrow(/changed since it was shown/);
    const p = await store.get("p-1");
    expect(p?.status).toBe("pending");
    expect(p?.acceptanceSig).toBeNull();
    expect(journal.events).toHaveLength(before);
  });

  it.each([
    ["no text at all", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { draft: SIGNED }],
    ["an array", [SIGNED]],
  ])("refuses an acceptance carrying %s", async (_label, seen) => {
    const { service, propose, store } = setup(target);
    await propose(SIGNED);
    await expect(service.accept("p-1", seen)).rejects.toThrow(/needs the text shown/);
    expect((await store.get("p-1"))?.status).toBe("pending");
  });

  it.each([
    ["CRLF line breaks", SIGNED.replace(/\n/g, "\r\n")],
    ["a trailing space", `${SIGNED} `],
    ["a leading line break", `\n${SIGNED}`],
    ["a composed é written as e + accent", SIGNED.replace("à", "a\u0300")],
    ["the empty text", ""],
    ["a prefix of the text", SIGNED.slice(0, -1)],
  ])("compares exactly, never normalised: %s is refused", async (_label, seen) => {
    const { service, propose, store } = setup(target);
    await propose(SIGNED);
    await expect(service.accept("p-1", seen)).rejects.toThrow(/changed since it was shown/);
    expect((await store.get("p-1"))?.status).toBe("pending");
  });

  it("an unknown proposal says so, whatever text comes with it", async () => {
    const { service } = setup(target);
    await expect(service.accept("p-none", SIGNED)).rejects.toThrow(/does not exist/);
  });

  it("a double click: the second acceptance of the same text is refused by the state", async () => {
    const { service, propose, store } = setup(target);
    await propose(SIGNED);
    await service.accept("p-1", SIGNED);
    await expect(service.accept("p-1", SIGNED)).rejects.toThrow();
    expect((await store.get("p-1"))?.sendAfter?.toISOString()).toBe("2026-10-05T10:02:00.000Z");
  });

  it.each([
    [2 * 60_000, 2],
    [10 * 60_000, 10],
    [150_000, 2],
    [10 * 60_000 - 1, 9],
    [30_000, 1],
  ])(
    "the page is told the box's undo delay, never more (%i ms → %i min)",
    async (undoMs, minutes) => {
      const { service, propose } = setup(target, "8", undoMs);
      await propose(SIGNED);
      expect((await service.list())[0]?.undoMinutes).toBe(minutes);
    },
  );
});

describe("where an accepted reply goes, shown on every proposal (M3)", () => {
  const target = { uid: 7, to: "claire@client.example", replyToElsewhere: false };
  it.each([
    ["test-domains", "test"],
    ["closed", "my_list"],
    ["correspondents", "real"],
  ] as const)("a box sending to %s shows %s", async (sending, delivery) => {
    const { service, propose } = setup(target, "8", 2 * 60_000, sending);
    await propose(SIGNED);
    const [view] = await service.list();
    expect(view?.delivery).toBe(delivery);
  });
});
