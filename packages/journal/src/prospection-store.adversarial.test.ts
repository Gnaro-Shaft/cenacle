// The prospection agent's cards (ADR-0032, sql/027), in the real database:
// one alert is one transaction; a duplicate is skipped and counted; the purge
// counts my last move; the table refuses what must never be kept; the agent's
// role cannot change a card; and an alert's mark leaves with the mail.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createMailStore } from "./mail-store.ts";
import { createProspectionStore, type NewCard } from "./prospection-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createProspectionStore(sql);
const run = randomBytes(4).toString("hex");
let nextId = 700_000 + (Date.now() % 50_000) * 10;
const mailId = () => ++nextId;
const card = (over: Partial<NewCard> = {}): NewCard => ({
  source: "mail",
  platform: "Plateforme fictive",
  title: `Ingénieur IA ${run}`,
  company: `Banque ${run}`,
  intermediary: "direct",
  stack: ["Python"],
  rate: [600, 700],
  remote: "total",
  place: "Lyon",
  link: "https://plateforme.example/m/1?u=x",
  note: null,
  column: "alert",
  reason: null,
  decidedBy: "rule",
  toCheck: false,
  duplicateKey: null,
  ...over,
});

describe("prospection store — one alert, one transaction", () => {
  it("adds the cards and marks the mail read", async () => {
    const id = mailId();
    expect(await store.recordMail(id, "read", [card(), card({ title: `Autre ${run}` })])).toEqual({
      added: 2,
      duplicates: 0,
    });
    expect(await store.unread([id, id + 1_000_000])).toEqual([id + 1_000_000]);
  });

  it("a duplicate key is skipped and counted, never an error", async () => {
    const key = `dup-${run}`;
    await store.recordMail(mailId(), "read", [card({ duplicateKey: key })]);
    expect(await store.recordMail(mailId(), "read", [card({ duplicateKey: key })])).toEqual({
      added: 0,
      duplicates: 1,
    });
  });

  it("a refused card undoes the whole alert: no card, no mark", async () => {
    const id = mailId();
    const bad = card({ link: "http://plateforme.example/x" });
    await expect(
      store.recordMail(id, "read", [card({ title: `Avant ${run}` }), bad]),
    ).rejects.toThrow();
    expect(await store.unread([id])).toEqual([id]);
    expect((await store.cards()).some((c) => c.title === `Avant ${run}`)).toBe(false);
  });

  it("a mail is marked once", async () => {
    const id = mailId();
    await store.recordMail(id, "no_offer", []);
    await expect(store.recordMail(id, "read", [])).rejects.toThrow();
  });
});

describe("prospection store — what the table refuses", () => {
  it.each<[string, Partial<NewCard>]>([
    ["an http link", { link: "http://plateforme.example/m" }],
    ["a javascript: link", { link: "javascript:alert(1)" }],
    ["a link with a space", { link: "https://plateforme.example/a b" }],
    ["a reversed rate", { rate: [700, 600] }],
    ["a title too long", { title: "x".repeat(121) }],
    ["an empty title", { title: "" }],
    ["eleven stack words", { stack: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["an unknown column", { column: "maybe" }],
    ["a mail card without its platform", { platform: null }],
    ["a note on a mail card", { note: "à moi" }],
    ["a card I typed, decided by the model", { source: "me", platform: null, decidedBy: "model" }],
  ])("refuses %s", async (_label, over) => {
    await expect(store.recordMail(mailId(), "read", [card(over)])).rejects.toThrow();
  });
});

describe("prospection store — purge, search, erasure", () => {
  // My moves come with the board (lot 3): only then can "after my last move" be tested.
  it("the agent's role cannot move a card; the purge takes what is older than the cutoff", async () => {
    const old = `Vieille ${run}`;
    const moved = `Déplacée ${run}`;
    await store.recordMail(mailId(), "read", [card({ title: old }), card({ title: moved })]);
    const owner = sql; // the app role cannot UPDATE (the agent never moves a card): set dates as a test setup
    await expect(
      owner`update prospection_cartes set moved_at = now() where title = ${moved}`,
    ).rejects.toThrow();
    expect(await store.purge(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(2);
    expect((await store.cards()).some((c) => c.title === old || c.title === moved)).toBe(false);
  });

  it("finds by company, never treating % or _ as wildcards", async () => {
    await store.recordMail(mailId(), "read", [card({ company: `Société_${run}` })]);
    expect(await store.byCompany(`société_${run}`)).toHaveLength(1);
    expect(await store.byCompany(`%${run}`)).toHaveLength(0);
  });

  it("erases one card, and says when there was none", async () => {
    await store.recordMail(mailId(), "read", [card({ title: `Effacée ${run}` })]);
    const target = (await store.cards()).find((c) => c.title === `Effacée ${run}`);
    expect(await store.erase(target?.id ?? -1)).toBe(true);
    expect(await store.erase(target?.id ?? -1)).toBe(false);
  });

  it("an alert's mark leaves with the mail's memory (trigger of 027)", async () => {
    const mails = createMailStore(sql);
    const id = mailId();
    await mails.saveInbox("0", [
      {
        uid: id,
        receivedAt: "2026-10-22T08:00:00Z",
        noFollowUp: false,
        urgentTerm: false,
        senderAuthenticated: true,
        senderKey: null,
        messageKey: null,
        threadKeys: [],
      },
    ]);
    await store.recordMail(id, "read", []);
    await mails.keepOnly("inbox", []);
    expect(await store.unread([id])).toEqual([id]);
  });
});
