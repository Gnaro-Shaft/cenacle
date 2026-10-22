// The board's rules on the page (ADR-0032, points 19 and 20): a link is
// clickable only in https, written exactly — the page checks again whatever
// the server sent; a mail's card always says AI extracted it; every column,
// reason and decider has words; a card in an unknown column is never lost.
import { describe, expect, it } from "vitest";
import {
  aiMark,
  byColumn,
  COLUMNS,
  clickable,
  columnLabel,
  deciderLabel,
  rateLabel,
  reasonLabel,
  remoteLabel,
} from "./board-rules.ts";

describe("clickable — https only, written exactly", () => {
  it("keeps an https link whole, query included", () => {
    expect(clickable("https://plateforme.test/r?u=1&b=2")).toBe(
      "https://plateforme.test/r?u=1&b=2",
    );
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://plateforme.test/",
    "HTTPS://plateforme.test/",
    "https:/plateforme.test",
    "https:plateforme.test",
    "https:///chemin",
    " https://plateforme.test",
    "https://plateforme.test/a b",
    'https://plateforme.test/"onmouseover=x',
    "//plateforme.test/x",
    "",
  ])("never makes %j a link", (link) => {
    expect(clickable(link)).toBeNull();
  });

  it("null stays null", () => {
    expect(clickable(null)).toBeNull();
  });
});

describe("words on the cards", () => {
  it("a mail's card says AI extracted it; mine does not", () => {
    expect(aiMark("mail")).toBe("extrait par IA");
    expect(aiMark("me")).toBeNull();
  });

  it("every column has its own words, in the board's order", () => {
    const labels = COLUMNS.map(([key]) => columnLabel(key));
    expect(new Set(labels).size).toBe(COLUMNS.length);
    expect(columnLabel("ailleurs")).toBe("colonne inconnue");
  });

  it("every stop reason has words; an unknown one is said, never shown raw", () => {
    for (const r of [
      "esn_list",
      "esn_phrase",
      "esn_model",
      "intermediary_unknown",
      "stack",
      "rate",
      "remote",
    ]) {
      expect(reasonLabel(r)).not.toMatch(/_|inconnue/);
    }
    expect(reasonLabel("<script>")).toBe("raison inconnue");
    expect(reasonLabel(null)).toBeNull();
  });

  it("says who decided: the model, a rule, or me", () => {
    expect(deciderLabel("model", "mail")).toMatch(/IA/);
    expect(deciderLabel("me", "me")).toBe("ajoutée par moi");
    expect(deciderLabel("me", "mail")).toBe("déplacée par moi");
  });

  it("rates and remote work read as words, never raw values", () => {
    expect(rateLabel(null)).toBe("TJM non dit");
    expect(rateLabel([600, 700])).toBe("600–700 €/j");
    expect(remoteLabel("<b>")).toBe("télétravail non dit");
  });
});

describe("byColumn", () => {
  it("every card lands once, a card in an unknown column in a column of its own", () => {
    const cards = [{ column: "alert" }, { column: "won" }, { column: "ailleurs" }];
    const columns = byColumn(cards);
    expect(columns.flatMap((c) => c.cards)).toHaveLength(3);
    expect(columns.at(-1)).toMatchObject({
      label: "Colonne inconnue",
      cards: [{ column: "ailleurs" }],
    });
  });
});
