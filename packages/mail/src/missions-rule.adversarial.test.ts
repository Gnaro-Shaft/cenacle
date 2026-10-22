// The "missions" box (ADR-0031) fills a board a later agent reads: a mail must
// enter it only by an exact address rule and an authenticated domain. A forged
// alert must not even rise from "bruit" to "à trier", where I would read it.
import { describe, expect, it } from "vitest";
import { senderOfSource } from "./reader.ts";
import { parseRules, RulesError, type Sortable, sortByRules } from "./rules.ts";
import { AUTH_VERDICTS } from "./sender-auth.ts";

const ALERT = "alertes@plateforme.example";
const rules = parseRules(
  [
    "[missions]",
    `adresses = ["${ALERT}"]`,
    "[bruit]",
    'domains = ["plateforme.example"]',
    "[administratif]",
    'domains = ["banque.example"]',
    "[clients_prospects]",
    'domains = ["client.example"]',
  ].join("\n"),
);

const sortOne = (ref: Omit<Sortable, "uid">) => {
  const result = sortByRules([{ uid: 1, ...ref }], rules);
  return { sorted: result.sorted[0], remaining: result.remaining.length, counts: result.counts };
};

describe("missions — the only way in", () => {
  it("an authenticated alert goes to missions, mass headers or not, decided by the rule", () => {
    for (const mass of [true, false]) {
      expect(
        sortOne({ domain: "plateforme.example", address: ALERT, auth: "authenticated", mass })
          .sorted,
      ).toEqual({ uid: 1, category: "missions", decidedBy: "rule" });
    }
  });

  it.each(AUTH_VERDICTS.filter((v) => v !== "authenticated"))(
    "a forged alert (%s) is sorted as if the rule did not exist: mass → bruit, never à trier",
    (auth) => {
      const mass = sortOne({ domain: "plateforme.example", address: ALERT, auth, mass: true });
      expect(mass.sorted).toEqual({ uid: 1, category: "bruit", decidedBy: "masse" });
      const plain = sortOne({ domain: "plateforme.example", address: ALERT, auth });
      expect(plain.sorted).toEqual({ uid: 1, category: "bruit", decidedBy: "rule" });
      expect(mass.counts.missions + plain.counts.missions).toBe(0);
    },
  );

  it.each([
    ["another address of the same domain", "pub@plateforme.example", "plateforme.example"],
    [
      "a look-alike domain",
      "alertes@plateforme.example.attacker.test",
      "plateforme.example.attacker.test",
    ],
    ["a subdomain", "alertes@mail.plateforme.example", "mail.plateforme.example"],
    ["a longer local part", "xalertes@plateforme.example", "plateforme.example"],
    ["a plus tag", "alertes+x@plateforme.example", "plateforme.example"],
  ])("%s never borrows the rule", (_label, address, domain) => {
    const { sorted } = sortOne({ domain, address, auth: "authenticated", mass: true });
    expect(sorted?.category).not.toBe("missions");
  });

  it("an address that does not belong to the sender's domain is not trusted", () => {
    // The address and the domain come from the same From header; if they ever
    // disagree, the authenticated domain is not the address's: no rule.
    const { sorted } = sortOne({ domain: "attacker.test", address: ALERT, auth: "authenticated" });
    expect(sorted?.category).not.toBe("missions");
  });

  it("an unknown or unreadable address never matches", () => {
    const base = { domain: "plateforme.example", auth: "authenticated" as const };
    for (const ref of [
      base,
      { ...base, address: null },
      { ...base, address: "" },
      { ...base, address: ALERT.toUpperCase() },
    ]) {
      expect(sortOne(ref).sorted?.category).toBe("bruit");
    }
  });

  it("decides before the administratif ceiling (ADR-0030) and before a client rule", () => {
    const both = parseRules(
      '[missions]\nadresses = ["offres@banque.example", "offres@client.example"]\n' +
        '[administratif]\ndomains = ["banque.example"]\n' +
        '[clients_prospects]\ndomains = ["client.example"]',
    );
    const result = sortByRules(
      [
        {
          uid: 1,
          domain: "banque.example",
          address: "offres@banque.example",
          auth: "authenticated" as const,
          mass: true,
        },
        {
          uid: 2,
          domain: "client.example",
          address: "offres@client.example",
          auth: "authenticated" as const,
        },
      ],
      both,
    );
    expect(result.sorted.map((s) => s.category)).toEqual(["missions", "missions"]);
    expect(result.remaining).toEqual([]);
  });

  it("an address rule never acts as a domain rule, nor a domain rule as an address", () => {
    const unknown = sortOne({ domain: "inconnu.example", address: ALERT, auth: "authenticated" });
    expect(unknown.remaining).toBe(1); // left for the model, which cannot answer "missions"
    const client = sortOne({
      domain: "client.example",
      address: "x@client.example",
      auth: "authenticated",
    });
    expect(client.sorted?.category).toBe("clients_prospects");
  });
});

describe("missions — refused rule files", () => {
  it.each([
    ["a domain instead of an address", '[missions]\nadresses = ["plateforme.example"]'],
    ["a wildcard", '[missions]\nadresses = ["*@plateforme.example"]'],
    ["an uppercase address", '[missions]\nadresses = ["Alertes@plateforme.example"]'],
    ["a display name", '[missions]\nadresses = ["Plateforme <alertes@plateforme.example>"]'],
    ["two addresses in one", '[missions]\nadresses = ["a@x.example, b@x.example"]'],
    ["an address twice", `[missions]\nadresses = ["${ALERT}", "${ALERT}"]`],
    ["the domains key", '[missions]\ndomains = ["plateforme.example"]'],
    ["a string instead of a list", `[missions]\nadresses = "${ALERT}"`],
    ["a non-string", "[missions]\nadresses = [42]"],
    ["a section that is not one", 'missions = ["x@y.example"]'],
  ])("refuses %s", (_label, source) => {
    expect(() => parseRules(source)).toThrow(RulesError);
  });
});

describe("senderOfSource — the replay reads the address as the postman does", () => {
  const source = (head: string, body = "Bonjour") =>
    Buffer.from(`${head}\r\n\r\n${body}`, "latin1");

  it("reads one From, lowercased, folded or not", () => {
    expect(senderOfSource(source("From: Plateforme\r\n <Alertes@Plateforme.example>"))).toBe(ALERT);
  });

  it("two From lines are ambiguous: no address", () => {
    expect(senderOfSource(source(`From: <${ALERT}>\r\nFrom: <x@attacker.test>`))).toBeNull();
  });

  it("a From line in the body is text, not a header", () => {
    expect(senderOfSource(source("Subject: x", `From: <${ALERT}>`))).toBeNull();
  });

  it("a group or a list of senders gives no address", () => {
    expect(senderOfSource(source(`From: <${ALERT}>, <x@attacker.test>`))).toBeNull();
  });
});
