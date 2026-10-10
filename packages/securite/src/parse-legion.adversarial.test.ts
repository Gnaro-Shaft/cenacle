// The bridge to Legion's ronde: a verdict cut short, undated, too old, from
// the future, with a host count that does not add up, a forged host name or a
// motif with strange characters "could not run" (it closes nothing); each of
// Legion's motif templates becomes its finding, a list of ports one finding
// per port; a number that changes keeps the same finding; the catalogue says
// on which machine to run its command. Host names here are fictional.
import { describe, expect, it } from "vitest";
import { fixFor } from "./catalogue.ts";
import { reconcile } from "./lifecycle.ts";
import { classifyMotif, LEGION_STALE_MS, parseLegionVerdict } from "./parse-legion.ts";
import { CheckOutputError } from "./types.ts";

const NOW = Date.parse("2026-10-10T20:30:00Z");
const instant = (ms = NOW) => String(Math.floor(ms / 1000));
const verdict = (lines: string[], at = instant()) =>
  ["etat=MALADE", `instant=${at}`, ...lines, "fin=1"].join("\n");
const TWO = ["hotes=2", "noeud-a.etat=MALADE", "vps-b.etat=SAIN"];

describe("a verdict that cannot be trusted could not run", () => {
  it.each([
    ["cut short (no fin=1)", ["etat=MALADE", `instant=${instant()}`, ...TWO].join("\n")],
    ["undated", verdict(TWO, "demain")],
    ["too old (three relays missed)", verdict(TWO, instant(NOW - LEGION_STALE_MS - 60_000))],
    ["from the future", verdict(TWO, instant(NOW + 10 * 60_000))],
    [
      "a host count that does not add up",
      verdict(["hotes=3", "noeud-a.etat=MALADE", "vps-b.etat=SAIN"]),
    ],
    ["a forged host name", verdict(["hotes=1", "Noeud A;rm.etat=MALADE"])],
    ["a motif for an undeclared host", verdict([...TWO, "fantome.motif1=redemarrage requis"])],
    [
      "a motif with control characters",
      verdict([...TWO, "noeud-a.motif1=redemarrage requis\u0007$(id)"]),
    ],
    ["a key given twice", verdict([...TWO, "noeud-a.etat=SAIN"])],
    ["an unknown state", ["etat=PEUT-ETRE", `instant=${instant()}`, ...TWO, "fin=1"].join("\n")],
    ["empty", ""],
  ])("%s", (_, raw) => {
    expect(() => parseLegionVerdict(raw, NOW)).toThrow(CheckOutputError);
  });

  it("just under 45 minutes old is still read", () => {
    expect(parseLegionVerdict(verdict(TWO, instant(NOW - LEGION_STALE_MS + 60_000)), NOW)).toEqual(
      [],
    );
  });
});

describe("each of Legion's motifs, its finding", () => {
  it("the real shapes of tonight's verdict", () => {
    const got = parseLegionVerdict(
      verdict([
        "hotes=2",
        "noeud-a.etat=MALADE",
        "noeud-a.motif1=disque / occupe a 90 %",
        "noeud-a.motif2=10 mise(s) a jour de securite en attente",
        "noeud-a.motif3=port(s) inattendu(s) : tcp/7500",
        "vps-b.etat=MALADE",
        "vps-b.motif1=port(s) inattendu(s) : tailnet/tcp/36157, tailnet/tcp/8790, udp/41641",
        "vps-b.motif2=12 service(s) tournent sur une bibliotheque remplacee",
      ]),
      NOW,
    );
    expect(got.map((o) => [o.target, o.type, o.occurrence, o.severity])).toEqual([
      ["noeud-a", "serveur_disque", "/", "eleve"],
      ["noeud-a", "serveur_maj_securite", "-", "eleve"],
      ["noeud-a", "serveur_port", "tcp/7500", "eleve"],
      ["vps-b", "serveur_port", "tailnet/tcp/36157", "eleve"],
      ["vps-b", "serveur_port", "tailnet/tcp/8790", "eleve"],
      ["vps-b", "serveur_port", "udp/41641", "eleve"],
      ["vps-b", "serveur_services", "-", "moyen"],
    ]);
    expect(got[0]?.title).toBe("noeud-a : disque / occupé à 90 %");
  });

  it("quorum is critical; under 90 % a disk is medium; reboot and missing ports", () => {
    expect(
      classifyMotif("n", "grappe sans quorum (1 vote(s) sur 2) — /etc/pve en lecture seule")[0]
        ?.severity,
    ).toBe("critique");
    expect(classifyMotif("n", "disque /var occupe a 85 %")[0]).toMatchObject({
      occurrence: "/var",
      severity: "moyen",
    });
    expect(
      classifyMotif("n", "redemarrage requis — un noyau corrige mais non charge")[0]?.type,
    ).toBe("serveur_redemarrage");
    expect(classifyMotif("n", "port(s) attendu(s) absent(s) : tcp/443")[0]).toMatchObject({
      type: "serveur_port_absent",
      occurrence: "tcp/443",
    });
  });

  it("any other motif is kept, under its words without their numbers", () => {
    const [a] = classifyMotif("n", "bulletin vieux de 412 s");
    const [b] = classifyMotif("n", "bulletin vieux de 980 s");
    expect(a).toMatchObject({ type: "serveur_autre", occurrence: "bulletin vieux de # s" });
    expect(b?.occurrence).toBe(a?.occurrence);
  });

  it("a forged port or mount is refused", () => {
    expect(() => classifyMotif("n", "port(s) inattendu(s) : tcp/80; curl x")).toThrow(
      CheckOutputError,
    );
    expect(() => classifyMotif("n", "disque /x$(id) occupe a 95 %")).toThrow(CheckOutputError);
  });
});

describe("followed like any finding", () => {
  it("10 then 12 updates: the same finding, touched, never reopened", () => {
    const at = (n: number) =>
      parseLegionVerdict(
        verdict([
          "hotes=1",
          "noeud-a.etat=MALADE",
          `noeud-a.motif1=${n} mise(s) a jour de securite en attente`,
        ]),
        NOW,
      );
    const first = at(10)[0];
    if (first === undefined) throw new Error("no finding");
    const active = [
      {
        id: 1,
        check: "legion_ronde",
        status: "ouvert" as const,
        type: first.type,
        target: first.target,
        occurrence: first.occurrence,
      },
    ];
    const plan = reconcile(active, [{ check: "legion_ronde", ran: true, observations: at(12) }]);
    expect(plan.insert).toEqual([]);
    expect(plan.touch[0]?.seen.title).toBe("noeud-a : 12 mise(s) à jour de sécurité en attente");
  });

  it("a stale verdict closes no server finding: it is itself the finding", () => {
    const active = [
      {
        id: 1,
        check: "legion_ronde",
        status: "ouvert" as const,
        type: "serveur_disque",
        target: "noeud-a",
        occurrence: "/",
      },
    ];
    const plan = reconcile(active, [{ check: "legion_ronde", ran: false }]);
    expect(plan.resolve).toEqual([]);
    expect(plan.insert[0]).toMatchObject({ type: "check_impossible", severity: "eleve" });
    expect(plan.insert[0]?.title).toMatch(/La ronde de Legion ne répond plus/);
  });
});

describe("the catalogue for the servers", () => {
  it("says on which machine, with commands from checked values only", () => {
    expect(
      fixFor(
        { type: "serveur_maj_securite", target: "noeud-a", occurrence: "-" },
        { host: "noeud-a" },
      ),
    ).toEqual({
      advice:
        "Sur noeud-a : appliquer les mises à jour de sécurité, puis voir si un redémarrage est demandé.",
      command: "sudo apt update && sudo apt full-upgrade",
    });
    expect(
      fixFor(
        { type: "serveur_port", target: "n", occurrence: "tcp/7500" },
        { host: "n", port: "tcp/7500" },
      ).command,
    ).toBe("sudo ss -lntup | grep ':7500 '");
    expect(
      fixFor(
        { type: "serveur_port", target: "n", occurrence: "x" },
        { host: "n", port: "tailnet/tcp/36157" },
      ),
    ).toMatchObject({ command: null, advice: expect.stringMatching(/joker tailnet\/tcp\/\*/) });
    expect(
      fixFor({ type: "serveur_redemarrage", target: "n", occurrence: "-" }, { host: "n" }).command,
    ).toBeNull();
    expect(
      fixFor(
        { type: "serveur_disque", target: "n", occurrence: "/" },
        { host: "Bad;host", mount: "/x;y" },
      ),
    ).toMatchObject({ command: null, advice: expect.stringMatching(/^Sur la machine/) });
  });
});
