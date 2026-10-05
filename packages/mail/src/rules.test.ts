import { CATEGORIES, loadFixtureMailbox } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE_RULES_PATH, loadRules, parseRules, sortByRules } from "./rules.ts";

describe("rules", () => {
  it("the example file is valid", () => {
    const { rules } = loadRules({
      local: "/nonexistent/regles.local.toml",
      example: EXAMPLE_RULES_PATH,
    });
    expect(rules.size).toBe(26);
  });

  it("says when it falls back to the example", () => {
    expect(loadRules({ local: "/nonexistent/x.toml", example: EXAMPLE_RULES_PATH }).example).toBe(
      true,
    );
  });

  it("sorts by exact domain and leaves the unknown ones", () => {
    const rules = parseRules('[bruit]\ndomains = ["news.example"]\n');
    const result = sortByRules(
      [
        { uid: 1, domain: "news.example", auth: "authenticated" as const },
        { uid: 2, domain: "other.example", auth: "authenticated" as const },
        { uid: 3, domain: null, auth: "missing" as const },
      ],
      rules,
    );
    expect(result.sorted).toEqual([
      { uid: 1, category: "bruit", decidedBy: "rule" },
      { uid: 3, category: "a_trier", decidedBy: "unreadable" },
    ]);
    expect(result.remaining).toEqual([{ uid: 2, domain: "other.example", auth: "authenticated" }]);
    expect(result.counts).toEqual({
      clients_prospects: 0,
      administratif: 0,
      bruit: 1,
      a_trier: 1,
      remaining: 1,
    });
  });

  it("on the fixtures, every rule-sorted mail lands in its expected category", () => {
    const { rules } = loadRules({ local: "/nonexistent/x.toml", example: EXAMPLE_RULES_PATH });
    const { messages } = loadFixtureMailbox();
    const refs = messages.map((m, i) => ({
      uid: i + 1,
      domain: m.from.address.split("@")[1]?.toLowerCase() ?? null,
      auth: "authenticated" as const,
    }));
    const { sorted, counts } = sortByRules(refs, rules);
    for (const { uid, category } of sorted) {
      expect(category).toBe(messages[uid - 1]?.expected.category);
    }
    expect(counts).toEqual({
      clients_prospects: 36,
      administratif: 40,
      bruit: 46,
      a_trier: 0,
      remaining: 25,
    });
    expect(Object.keys(counts)).toEqual([...CATEGORIES, "remaining"]);
  });
});

describe("[sans_suivi]", () => {
  it("lists the domains that never get a follow-up, without making them a category", () => {
    const loaded = loadRules({ local: "/nonexistent/x.toml", example: EXAMPLE_RULES_PATH });
    expect([...loaded.noFollowUp]).toEqual(["plateforme-freelance.example"]);
    expect(loaded.rules.has("plateforme-freelance.example")).toBe(true);
  });

  it("checks its domains as strictly as the categories", () => {
    expect(() => parseRules('[sans_suivi]\ndomains = ["*.plateforme.example"]')).toThrow(
      /invalid domain/,
    );
  });
});
