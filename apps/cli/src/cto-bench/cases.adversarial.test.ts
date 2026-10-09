// The bench's criteria (J3b): a defect counts as found only when one
// paragraph names it — words scattered across a review do not count — and
// every case points at commits that exist in this repository's history.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BENCH, found, paragraphs } from "./cases.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const byId = (id: string) => {
  const c = BENCH.find((b) => b.id === id);
  if (c === undefined) throw new Error(`no case ${id}`);
  return c;
};

describe("the bench of the CTO's review", () => {
  it("six cases, distinct, as decided", () => {
    expect(BENCH.map((c) => c.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(new Set(BENCH.map((c) => c.commit)).size).toBe(6);
  });

  it.each(BENCH.map((c) => [c.id, c.commit, c.fixedBy]))(
    "case %s: its commit %s and its fix %s exist",
    (_, commit, fix) => {
      for (const ref of [commit, fix]) {
        expect(() =>
          execFileSync("git", ["-C", ROOT, "cat-file", "-e", `${ref}^{commit}`], {
            stdio: "pipe",
          }),
        ).not.toThrow();
      }
    },
  );

  it("found when one paragraph names the defect", () => {
    const review =
      "Intro.\n\n**Important** — `install` lance `bootstrap` juste après `bootout`, sans attendre l'arrêt du service.";
    expect(found(review, byId("A"))).toBe(true);
  });

  it("not found when the words are scattered across paragraphs", () => {
    const review = "On appelle bootout ici.\n\nPlus loin, bootstrap.\n\nIl faudrait attendre.";
    expect(found(review, byId("A"))).toBe(false);
  });

  it("not found on a review that says nothing of it", () => {
    for (const c of BENCH) expect(found("Aucun défaut trouvé.", c)).toBe(false);
  });

  it("a criterion is not met by the case's own words alone (B needs the projection)", () => {
    expect(found("On écrit `mail.set_aside` dans le journal.", byId("B"))).toBe(false);
    expect(
      found(
        "`mail.set_aside` n'est pas déclaré dans la projection : Iris passe malade.",
        byId("B"),
      ),
    ).toBe(true);
  });

  it("E is not met by a cited `unknown` in a paragraph about something else (corrected 2026-10-09)", () => {
    const misleading =
      "Ligne 50 : `error instanceof Error ? error.name : \"unknown\"` ; le `purge.failed` n'est qu'un compte rendu.";
    expect(found(misleading, byId("E"))).toBe(false);
    expect(
      found("`purge.done` n'est pas déclaré dans la projection : Iris passe malade.", byId("E")),
    ).toBe(true);
  });

  it("paragraphs split on blank lines only", () => {
    expect(paragraphs("a\nb\n\n  \nc")).toEqual(["a\nb", "c"]);
  });
});
