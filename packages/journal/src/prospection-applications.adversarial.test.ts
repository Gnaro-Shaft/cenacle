// The "Candidature" cards (ADR-0034, sql/028), in the real database: a
// confirmation adds one card in « applied », or none when the same mission
// is already there or beyond — under either key; the mail is marked in the
// same transaction; the table keeps the new reason to a confirmation's card;
// and the mails I must read myself are counted.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createProspectionStore, type NewCard } from "./prospection-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createProspectionStore(sql);
const run = randomBytes(4).toString("hex");
let nextId = 760_000 + (Date.now() % 50_000) * 10;
const mailId = () => ++nextId;
const base = (tag: string) => `plateforme fictive|ingenieur ${run} ${tag}|banque ${run}|lyon`;
const applied = (tag: string, over: Partial<NewCard> = {}): NewCard => ({
  source: "mail",
  platform: "Plateforme fictive",
  title: `Ingénieur ${run} ${tag}`,
  company: `Banque ${run}`,
  intermediary: "inconnu",
  stack: [],
  rate: null,
  remote: "inconnu",
  place: "Lyon",
  link: "https://plateforme.example/m/1",
  note: null,
  column: "applied",
  reason: "application_confirmed",
  decidedBy: "rule",
  toCheck: false,
  duplicateKey: `applied|${base(tag)}`,
  ...over,
});
const alertCard = (tag: string): NewCard => ({
  ...applied(tag),
  intermediary: "direct",
  remote: "total",
  column: "alert",
  reason: null,
  duplicateKey: base(tag),
});
const byKey = async (key: string) => (await store.cards()).filter((c) => c.duplicateKey === key);

describe("a confirmation's card", () => {
  it("is added in « applied » and the mail marked, in one transaction", async () => {
    const id = mailId();
    expect(await store.recordApplication(id, applied("a"), base("a"))).toEqual({ added: true });
    expect(await store.unread([id])).toEqual([]);
    const [card] = await byKey(`applied|${base("a")}`);
    expect(card).toMatchObject({
      column: "applied",
      decidedBy: "rule",
      reason: "application_confirmed",
    });
  });

  it("the same confirmation twice adds one card; the second mail is still marked", async () => {
    await store.recordApplication(mailId(), applied("b"), base("b"));
    const second = mailId();
    expect(await store.recordApplication(second, applied("b"), base("b"))).toEqual({
      added: false,
    });
    expect(await store.unread([second])).toEqual([]);
    expect(await byKey(`applied|${base("b")}`)).toHaveLength(1);
  });

  it("a mission still in « alert » does not stop it, and is left untouched", async () => {
    await store.recordMail(mailId(), "read", [alertCard("c")]);
    expect(await store.recordApplication(mailId(), applied("c"), base("c"))).toEqual({
      added: true,
    });
    const [old] = await byKey(base("c"));
    expect(old).toMatchObject({ column: "alert", movedAt: null });
  });

  it.each(["applied", "interview", "won", "lost"])(
    "a mission I moved to « %s » myself stops it",
    async (column) => {
      const tag = `d-${column}`;
      await store.recordMail(mailId(), "read", [alertCard(tag)]);
      const [old] = await byKey(base(tag));
      if (old === undefined) throw new Error("no card");
      await store.move(old.id, column);
      expect(await store.recordApplication(mailId(), applied(tag), base(tag))).toEqual({
        added: false,
      });
    },
  );

  it("a mission I dismissed does not stop it: I applied after all", async () => {
    await store.recordMail(mailId(), "read", [alertCard("e")]);
    const [old] = await byKey(base("e"));
    if (old === undefined) throw new Error("no card");
    await store.move(old.id, "dismissed");
    expect(await store.recordApplication(mailId(), applied("e"), base("e"))).toEqual({
      added: true,
    });
  });

  it("no company, no key: always added, never taken for a duplicate", async () => {
    const card = applied("f", { company: null, duplicateKey: null });
    expect(await store.recordApplication(mailId(), card, null)).toEqual({ added: true });
    expect(await store.recordApplication(mailId(), card, null)).toEqual({ added: true });
  });

  it("only a confirmation's card, in « applied », goes this way", async () => {
    await expect(
      store.recordApplication(mailId(), { ...applied("g"), column: "alert" }, null),
    ).rejects.toThrow(/applied/);
    await expect(
      store.recordApplication(mailId(), { ...applied("g"), source: "me", platform: null }, null),
    ).rejects.toThrow(/applied/);
  });

  it("the table keeps the new reason to a confirmation's card, decided by a rule", async () => {
    await expect(
      store.recordMail(mailId(), "read", [{ ...alertCard("h"), reason: "application_confirmed" }]),
    ).rejects.toThrow();
    await expect(
      store.recordApplication(mailId(), applied("i", { decidedBy: "model" }), null),
    ).rejects.toThrow();
  });

  it("my move clears the reason: the card leaves « applied » freely", async () => {
    await store.recordApplication(mailId(), applied("j"), base("j"));
    const [card] = await byKey(`applied|${base("j")}`);
    if (card === undefined) throw new Error("no card");
    expect(await store.move(card.id, "interview")).toBe("applied");
    expect((await byKey(`applied|${base("j")}`))[0]).toMatchObject({
      column: "interview",
      reason: null,
    });
  });
});

describe("the mails I must read myself", () => {
  it("counts the floor's alerts and the confirmations the model could not read", async () => {
    const before = await store.toReadByHand();
    await store.recordMail(mailId(), "floor", []);
    await store.recordMail(mailId(), "application_unreadable", []);
    await store.recordMail(mailId(), "application_unreadable", []);
    await store.recordMail(mailId(), "unparsable", []);
    expect(await store.toReadByHand()).toEqual({
      floor: before.floor + 1,
      applications: before.applications + 2,
    });
  });
});
