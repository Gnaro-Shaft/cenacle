// The verdict for the Parc tab (14/11): as strict as the check on its shape,
// but a stale verdict is shown — marked — instead of refused; the check
// itself (parseLegionVerdict) still refuses it.
import { describe, expect, it } from "vitest";
import { legionView, parseLegionVerdict } from "./parse-legion.ts";

// Each source gives its limit (ADR-0040); Legion's, with Legion, is gone.
const STALE_MS = 20 * 60_000;

const NOW = Date.parse("2026-11-14T18:00:00Z");
const verdict = (instantMs: number, extra: string[] = []) =>
  [
    "etat=SOUFFRANT",
    `instant=${Math.floor(instantMs / 1000)}`,
    "hotes=2",
    "alpha.etat=SAIN",
    "beta.etat=SOUFFRANT",
    "beta.motif1=redemarrage requis — un noyau corrige mais non charge",
    "beta.motif2=port(s) attendu(s) absent(s) : local/tcp/5984, tailnet/tcp/3002",
    ...extra,
    "fin=1",
  ].join("\n");

describe("legionView", () => {
  it("a fresh verdict: each host, its state, its motifs in words without the host", () => {
    const view = legionView(verdict(NOW - 60_000), NOW, STALE_MS);
    expect(view.state).toBe("SOUFFRANT");
    expect(view.stale).toBe(false);
    expect(view.hosts).toEqual([
      { name: "alpha", state: "SAIN", motifs: [] },
      {
        name: "beta",
        state: "SOUFFRANT",
        motifs: [
          "redémarrage requis (noyau corrigé non chargé)",
          "port attendu absent local/tcp/5984",
          "port attendu absent tailnet/tcp/3002",
        ],
      },
    ]);
  });

  it("too old, or from the future: shown, marked stale — and still refused by the check", () => {
    for (const at of [NOW - STALE_MS - 60_000, NOW + 10 * 60_000]) {
      expect(legionView(verdict(at), NOW, STALE_MS).stale).toBe(true);
      expect(() => parseLegionVerdict(verdict(at), NOW, STALE_MS)).toThrow();
    }
  });

  it.each([
    ["cut short (no fin=1)", verdict(NOW).replace("\nfin=1", "")],
    ["a key twice", verdict(NOW, ["alpha.etat=SAIN"])],
    ["more hosts than it counts", verdict(NOW, ["gamma.etat=SAIN"])],
    ["a host name out of shape", verdict(NOW).replaceAll("alpha", "Alpha!")],
    ["a host state unknown", verdict(NOW).replace("alpha.etat=SAIN", "alpha.etat=OK")],
    ["a motif for a host it does not count", verdict(NOW, ["gamma.motif1=x"])],
    ["an undated verdict", verdict(NOW).replace(/instant=\d+/, "instant=hier")],
    ["a motif with characters Legion never writes", verdict(NOW, ["alpha.motif1=<b>{x}</b>"])],
  ])("%s: refused whole, never half shown", (_what, raw) => {
    expect(() => legionView(raw, NOW, STALE_MS)).toThrow();
  });

  it("a control character in a motif is taken out, never shown", () => {
    const view = legionView(
      verdict(NOW, ["alpha.motif1=disque / occupe a 95 %\u0007"]),
      NOW,
      STALE_MS,
    );
    expect(view.hosts[0]?.motifs).toEqual(["disque / occupé à 95 %"]);
  });

  it("the check reads the same verdict as before the split", () => {
    const found = parseLegionVerdict(verdict(NOW - 60_000), NOW, STALE_MS);
    expect(found.map((o) => o.type)).toEqual([
      "serveur_redemarrage",
      "serveur_port_absent",
      "serveur_port_absent",
    ]);
  });
});
