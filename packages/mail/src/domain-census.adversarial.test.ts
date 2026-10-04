// The domain census helps me write my rules: it must count the real sender,
// never be fooled by a display name, skip the opposition list, flag
// mass-market mailboxes, and let nothing but domains and counts out.
import { describe, expect, it } from "vitest";
import { censusDomains } from "./domain-census.ts";

const none = () => false;
const run = (inbox: (string | null)[], sent: { to: string | null; cc: string | null }[] = []) =>
  censusDomains({ inbox, sent, isOpposed: none, myDomain: "cabinet.example" });

describe("censusDomains", () => {
  it("counts received and sent per domain, most frequent first", () => {
    const c = run(
      ["Claire <claire@client.example>", "paul@client.example", "news@lettre.example"],
      [{ to: "claire@client.example", cc: "x@autre.example" }],
    );
    expect(c.domains.map((d) => [d.domain, d.received, d.sent])).toEqual([
      ["client.example", 2, 1],
      ["autre.example", 0, 1],
      ["lettre.example", 1, 0],
    ]);
  });

  it("a display name holding another address does not fool it: the real address counts", () => {
    const c = run(['"patron@client.example" <pirate@attaquant.example>']);
    expect(c.domains.map((d) => d.domain)).toEqual(["attaquant.example"]);
  });

  it.each([
    ["two senders", "a@client.example, b@autre.example"],
    ["a group", "equipe: a@client.example, b@client.example;"],
    ["no address", "Claire"],
    ["an empty header", ""],
    ["a missing header", null],
  ])("%s: unreadable, counts for nothing", (_label, from) => {
    const c = run([from]);
    expect(c.domains).toEqual([]);
    expect(c.unreadable).toBe(1);
  });

  it("case does not split a domain; a subdomain stays its own line", () => {
    const c = run(["a@Client.EXAMPLE", "b@client.example", "c@mail.client.example"]);
    expect(c.domains.map((d) => [d.domain, d.received])).toEqual([
      ["client.example", 2],
      ["mail.client.example", 1],
    ]);
  });

  it("one sent mail to three people of a domain counts once for it", () => {
    const c = run([], [{ to: "a@client.example, b@client.example", cc: "c@client.example" }]);
    expect(c.domains).toEqual([
      { domain: "client.example", received: 0, sent: 1, massMarket: false, mine: false },
    ]);
  });

  it("the opposition list is honoured, received and sent", () => {
    const c = censusDomains({
      inbox: ["oppose@client.example", "autre@client.example"],
      sent: [{ to: "oppose@client.example", cc: null }],
      isOpposed: (a) => a === "oppose@client.example",
      myDomain: null,
    });
    expect(c.domains).toEqual([
      { domain: "client.example", received: 1, sent: 0, massMarket: false, mine: false },
    ]);
    expect(c.opposed).toBe(2);
  });

  it("mass-market mailboxes and my own domain are flagged", () => {
    const c = run(["x@gmail.com", "y@Orange.fr", "moi@cabinet.example"]);
    const flags = Object.fromEntries(c.domains.map((d) => [d.domain, [d.massMarket, d.mine]]));
    expect(flags).toEqual({
      "gmail.com": [true, false],
      "orange.fr": [true, false],
      "cabinet.example": [false, true],
    });
  });

  it("nothing but domains and counts comes out: no local part, no name", () => {
    const c = run(
      ["Claire Fictive <claire.secret@client.example>"],
      [{ to: "Paul <paul@x.example>", cc: null }],
    );
    expect(JSON.stringify(c)).not.toMatch(/claire|secret|fictive|paul/i);
  });

  it("broken To/Cc headers count nothing, and do not throw", () => {
    expect(() => run([], [{ to: "equipe: a@b.example;", cc: "<<<>>>" }])).not.toThrow();
    expect(run([], [{ to: "equipe: a@b.example;", cc: "<<<>>>" }]).domains).toEqual([]);
  });
});
