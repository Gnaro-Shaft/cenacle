// ADR-0044, point 7: the reload's transaction text and what is read of
// psql's errors. The checks made before the writers stop are made again
// inside the transaction (a writer could have written in between); a
// replace never runs while the findings' dependents hold rows. Of psql's
// errors, only its own ERROR line with this module's marker is read: a COPY
// error quotes its row, and a forged row could carry a marker.
import { describe, expect, it } from "vitest";
import { markerOf, refuseState, reloadText } from "./recharge.ts";

const SCRIPT = "\\restrict k\nCOPY public.rappels (id) FROM stdin;\n\\.\n\\unrestrict k\n";

describe("reloadText", () => {
  it("empty tables: each checked empty inside the transaction, nothing deleted", () => {
    const text = reloadText(SCRIPT, "vides");
    for (const t of ["rappels", "prospection_cartes", "veille_articles", "securite_constats"]) {
      expect(text).toContain(
        `FROM public.${t}) THEN RAISE EXCEPTION 'cenacle-restaurer:non-vide:${t}'`,
      );
    }
    expect(text).not.toMatch(/DELETE/);
    expect(text.endsWith(SCRIPT)).toBe(true);
  });

  it("replace: the dependents checked empty, then the four emptied, before the script", () => {
    const text = reloadText(SCRIPT, "remplacer");
    expect(text).toContain("'cenacle-restaurer:dependante:serveur_actions'");
    expect(text).toContain("'cenacle-restaurer:dependante:securite_raisons'");
    const deleted = text.indexOf("DELETE FROM public.securite_constats;");
    expect(deleted).toBeGreaterThan(text.indexOf("dependante:serveur_actions"));
    expect(deleted).toBeLessThan(text.indexOf(SCRIPT));
  });

  it("locks the six tables first", () => {
    expect(reloadText(SCRIPT, "essai").split("\n")[0]).toBe(
      "LOCK TABLE public.rappels, public.prospection_cartes, public.veille_articles, public.securite_constats, public.securite_raisons, public.serveur_actions IN ACCESS EXCLUSIVE MODE;",
    );
  });
});

describe("refuseState", () => {
  const counts = (n: Record<string, number>) => new Map(Object.entries(n));
  it("a trial refuses nothing: the test base is emptied", () => {
    expect(() => refuseState(counts({ rappels: 3, serveur_actions: 2 }), "essai")).not.toThrow();
  });
});

describe("markerOf", () => {
  it("reads psql's own ERROR line", () => {
    const err =
      "psql:<stdin>:3: ERROR:  cenacle-restaurer:non-vide:rappels\n" +
      "CONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n";
    expect(markerOf(err)).toBe("non-vide:rappels");
  });

  it("never a marker carried by a quoted row", () => {
    const err =
      'psql:<stdin>:40: ERROR:  new row for relation "rappels" violates check constraint "x"\n' +
      "DETAIL:  Failing row contains (1, cenacle-restaurer:non-vide:rappels, …).\n" +
      "DETAIL:  cenacle-restaurer:non-vide:rappels\n" +
      'CONTEXT:  COPY rappels, line 1: "1\tERROR:  cenacle-restaurer:non-vide:rappels"\n';
    expect(markerOf(err)).toBeNull();
  });
});
