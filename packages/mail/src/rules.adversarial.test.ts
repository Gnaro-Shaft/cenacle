// A rule decides without a model, so the rules file must be unambiguous, and
// a look-alike domain must never borrow a trusted domain's rule.
import { loadFixtureMailbox } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE_RULES_PATH, loadRules, parseRules, RulesError, sortByRules } from "./rules.ts";

describe("rules — refused files", () => {
  it.each([
    ["an unknown category", '[spam]\ndomains = ["a.example"]'],
    ["a rule to À trier", '[a_trier]\ndomains = ["a.example"]'],
    [
      "a domain in two categories",
      '[bruit]\ndomains = ["a.example"]\n[administratif]\ndomains = ["a.example"]',
    ],
    ["a wildcard", '[bruit]\ndomains = ["*.a.example"]'],
    ["an uppercase domain", '[bruit]\ndomains = ["A.example"]'],
    ["an address instead of a domain", '[bruit]\ndomains = ["x@a.example"]'],
    ["a single-label domain", '[bruit]\ndomains = ["localhost"]'],
    ["a leading dot", '[bruit]\ndomains = [".a.example"]'],
    ["a non-string", "[bruit]\ndomains = [42]"],
    ["a string instead of a list", '[bruit]\ndomains = "a.example"'],
    ["a typo'd key", '[bruit]\ndomain = ["a.example"]'],
    ["a top-level key", 'domains = ["a.example"]'],
    ["invalid TOML", "[bruit\ndomains ="],
  ])("refuses %s", (_label, source) => {
    expect(() => parseRules(source)).toThrow(RulesError);
  });
});

describe("rules — look-alike senders", () => {
  const rules = parseRules('[clients_prospects]\ndomains = ["client.example"]\n');

  it.each([
    "client.example.attacker.test",
    "mail.client.example",
    "client-example.test",
    "cl1ent.example",
    "xclient.example",
  ])("does not give %s the client rule", (domain) => {
    expect(
      sortByRules([{ uid: 1, domain, auth: "authenticated" as const }], rules).remaining,
    ).toHaveLength(1);
  });

  it("the fixtures' spoofed host does not pass for the real one", () => {
    const { rules: example } = loadRules({
      local: "/nonexistent/x.toml",
      example: EXAMPLE_RULES_PATH,
    });
    const { messages } = loadFixtureMailbox();
    const spoof = messages.find((m) => m.expected.trap === "usurpation_domaine");
    const domain = spoof?.from.address.split("@")[1] ?? "";
    expect(domain).toMatch(/\.attaquant\.test$/);
    expect(
      sortByRules([{ uid: 1, domain, auth: "authenticated" as const }], example).remaining,
    ).toHaveLength(1);
  });

  it("no trap mail outside the legitimate client one is decided by a rule", () => {
    const { rules: example } = loadRules({
      local: "/nonexistent/x.toml",
      example: EXAMPLE_RULES_PATH,
    });
    const { messages } = loadFixtureMailbox();
    const refs = messages.map((m, i) => ({
      uid: i + 1,
      domain: m.from.address.split("@")[1] ?? null,
      auth: "authenticated" as const,
    }));
    const { sorted } = sortByRules(refs, example);
    const trapped = sorted
      .map(({ uid }) => messages[uid - 1]?.expected.trap)
      .filter((trap) => trap !== null);
    expect(trapped.sort()).toEqual(["injection_dans_mail_legitime", "injection_dans_objet"]);
  });
});
