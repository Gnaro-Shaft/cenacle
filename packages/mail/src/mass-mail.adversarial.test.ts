// Mass mail (ADR-0029): a mail's own bulk headers may send it down to
// "Bruit", never up, and never past a client rule — which decides as before,
// authenticated or not. Headers anyone can write, read strictly.
import { describe, expect, it } from "vitest";
import { isMassMail } from "./mass-mail.ts";
import type { HeaderField } from "./ordered-headers.ts";
import { parseRules, sortByRules } from "./rules.ts";
import { AUTH_VERDICTS, type AuthVerdict } from "./sender-auth.ts";

const f = (name: string, value: string): HeaderField => ({ name, value });

describe("isMassMail", () => {
  it.each([
    ["List-Unsubscribe", [f("list-unsubscribe", "<mailto:stop@lettre.example>")]],
    ["List-Id", [f("list-id", "Lettre <lettre.example>")]],
    ["Precedence: bulk", [f("precedence", "bulk")]],
    ["Precedence: list", [f("precedence", "list")]],
    ["Precedence: junk", [f("precedence", "junk")]],
    ["any case", [f("precedence", "BuLk")]],
    ["a comment first", [f("precedence", "(envoi groupe) bulk")]],
    ["a comment after", [f("precedence", "list (envoi groupe)")]],
    ["a parameter after", [f("precedence", "bulk; x=1")]],
    ["written twice", [f("list-unsubscribe", "<a>"), f("list-unsubscribe", "<b>")]],
    ["among other headers", [f("from", "a@b.example"), f("list-id", "<x>"), f("subject", "s")]],
  ])("%s: mass", (_label, fields) => {
    expect(isMassMail(fields)).toBe(true);
  });

  it.each([
    ["no header", []],
    ["an empty List-Unsubscribe", [f("list-unsubscribe", "")]],
    ["a blank List-Id", [f("list-id", "   ")]],
    ["Precedence: first-class", [f("precedence", "first-class")]],
    ["Precedence: normal", [f("precedence", "normal")]],
    ["a word that only starts like it", [f("precedence", "bulkish")]],
    ["a word that only contains it", [f("precedence", "junk-mail")]],
    ["only a comment", [f("precedence", "(bulk)")]],
    ["an empty Precedence", [f("precedence", "")]],
    ["a look-alike header", [f("x-list-unsubscribe", "<a>")]],
    ["List-Unsubscribe-Post alone", [f("list-unsubscribe-post", "List-Unsubscribe=One-Click")]],
    ["Auto-Submitted (not counted, ADR-0029)", [f("auto-submitted", "auto-generated")]],
  ])("%s: not mass", (_label, fields) => {
    expect(isMassMail(fields as HeaderField[])).toBe(false);
  });

  it("a hostile Precedence is read in linear time", () => {
    const value = `${"(".repeat(200_000)} bulk`;
    const started = Date.now();
    expect(isMassMail([f("precedence", value)])).toBe(false);
    expect(isMassMail([f("precedence", `${"(a)".repeat(100_000)} junk`)])).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("sortByRules with mass mail (ADR-0029)", () => {
  const rules = parseRules(`
[clients_prospects]
domains = ["client.example"]
[administratif]
domains = ["banque.example"]
[bruit]
domains = ["pub.example"]
`);
  const one = (
    domain: string | null,
    mass: boolean | undefined,
    auth: AuthVerdict = "authenticated",
  ) => {
    const result = sortByRules(
      [{ uid: 1, domain, auth, ...(mass === undefined ? {} : { mass }) }],
      rules,
    );
    return { sorted: result.sorted[0], remaining: result.remaining.length, result };
  };

  it("an unknown domain, mass: bruit, decided by masse, before the model", () => {
    const { sorted, remaining, result } = one("lettre.example", true);
    expect(sorted).toEqual({ uid: 1, category: "bruit", decidedBy: "masse" });
    expect(remaining).toBe(0);
    expect(result.mass).toBe(1);
    expect(result.counts.bruit).toBe(1);
  });

  it("an administratif rule, mass: left for the model (ADR-0030) — invoices come with bulk headers too", () => {
    const { sorted, remaining, result } = one("banque.example", true);
    expect(sorted).toBeUndefined();
    expect(remaining).toBe(1);
    expect(result.mass).toBe(0);
  });

  it("a bruit rule, mass: bruit too, by masse", () => {
    expect(one("pub.example", true).sorted?.decidedBy).toBe("masse");
  });

  it("a client rule, authenticated, mass: still a client, by the rule", () => {
    const { sorted, result } = one("client.example", true);
    expect(sorted).toEqual({ uid: 1, category: "clients_prospects", decidedBy: "rule" });
    expect(result.mass).toBe(0);
  });

  it.each(AUTH_VERDICTS.filter((v) => v !== "authenticated"))(
    "a client rule, %s sender, mass: still À trier — mass headers never let it escape",
    (auth) => {
      expect(one("client.example", true, auth).sorted).toEqual({
        uid: 1,
        category: "a_trier",
        decidedBy: "unauthenticated",
      });
    },
  );

  it("an unreadable sender, mass: still À trier, unreadable", () => {
    expect(one(null, true).sorted).toEqual({
      uid: 1,
      category: "a_trier",
      decidedBy: "unreadable",
    });
  });

  it.each([false, undefined])("mass %s: exactly as before", (mass) => {
    expect(one("banque.example", mass).sorted).toEqual({
      uid: 1,
      category: "administratif",
      decidedBy: "rule",
    });
    expect(one("lettre.example", mass).remaining).toBe(1);
  });

  it("mass can never put a mail in clients_prospects or administratif", () => {
    for (const domain of ["client.example", "banque.example", "pub.example", "x.example", null]) {
      for (const auth of AUTH_VERDICTS) {
        const withMass = one(domain, true, auth).sorted;
        const without = one(domain, false, auth).sorted;
        if (withMass?.decidedBy === "masse") expect(withMass.category).toBe("bruit");
        // Left for the model only where a rule said administratif: capped there (ADR-0030).
        else if (withMass === undefined && without !== undefined)
          expect(without.category).toBe("administratif");
        else expect(withMass).toEqual(without);
      }
    }
  });
});
