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
        { uid: 1, domain: "news.example" },
        { uid: 2, domain: "other.example" },
        { uid: 3, domain: null },
      ],
      rules,
    );
    expect(result.sorted).toEqual([
      { uid: 1, category: "bruit", decidedBy: "rule" },
      { uid: 3, category: "a_trier", decidedBy: "unreadable" },
    ]);
    expect(result.remaining).toEqual([{ uid: 2, domain: "other.example" }]);
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
