// The validation page: the recipient comes from the server (the sender, never
// the Reply-To), red flags are computed, and nothing is accepted without a
// readable recipient or with a slot left.
import type { MailForModel } from "@cenacle/core";
import { createProposals, EXAMPLE_TRAMES_PATH, loadTrames, type ReplyTarget } from "@cenacle/mail";
import { memoryJournal, memoryProposalStore } from "@cenacle/mail/test-helpers";
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

function setup(target: ReplyTarget | undefined, validity = "8") {
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
    await service.accept("p-1");
    expect((await store.get("p-1"))?.status).toBe("accepted");
  });

  it.each([
    ["the sender cannot be read", { uid: 7, to: null, replyToElsewhere: false }, /cannot be read/],
    ["the mail is gone", undefined, /no longer on the server/],
  ])("refuses when %s", async (_label, target, error) => {
    const { service, propose, store } = setup(target as ReplyTarget | undefined);
    await propose(SIGNED);
    await expect(service.accept("p-1")).rejects.toThrow(error);
    expect((await store.get("p-1"))?.status).toBe("pending");
  });

  it("my edit is checked: type, length, control characters", () => {
    expect(cleanDraft("  Bonjour\r\nClaire  ")).toBe("Bonjour\nClaire");
    for (const bad of [42, null, "", "x".repeat(5001), "Bonjour\u0000", "Bcc:\u001bx"]) {
      expect(() => cleanDraft(bad)).toThrow();
    }
  });
});
