// The ronde's verdict (ADR-0040, R2): Legion's format to the byte, and read
// back by the security agent's own reader of Legion's verdict — the proof
// that the contract holds: every motif the rules can say is a finding of the
// right kind there, none refused, none lost.
import { describe, expect, it } from "vitest";
import { legionView, parseLegionVerdict } from "./parse-legion.ts";
import { failureVerdict } from "./ronde-rules.ts";
import { type NamedVerdict, verdictText } from "./ronde-verdict.ts";

const INSTANT = 1_794_679_266;
const NOW_MS = INSTANT * 1000;

describe("Legion's format", () => {
  it("a MALADE host whose motif holds line breaks (Legion's test, pinned)", () => {
    const text = verdictText(
      [{ name: "v10", state: "MALADE", motifs: ["avant\nfin=1\napres"] }],
      INSTANT,
    );
    expect(text).toBe(
      `etat=MALADE\ninstant=${INSTANT}\nhotes=1\nv10.etat=MALADE\nv10.motif1=avant fin=1 apres\nfin=1\n`,
    );
  });

  it("hosts in the order given, the worst state on top, motifs numbered from 1", () => {
    const text = verdictText(
      [
        { name: "beta", state: "SAIN", motifs: [] },
        { name: "alpha", state: "SOUFFRANT", motifs: ["un", "deux"] },
      ],
      INSTANT,
    );
    expect(text.split("\n")).toEqual([
      "etat=SOUFFRANT",
      `instant=${INSTANT}`,
      "hotes=2",
      "beta.etat=SAIN",
      "alpha.etat=SOUFFRANT",
      "alpha.motif1=un",
      "alpha.motif2=deux",
      "fin=1",
      "",
    ]);
  });

  it("no machine: no verdict at all (Legion writes none either)", () => {
    expect(() => verdictText([], INSTANT)).toThrow();
  });
});

/** Every motif the ronde can say, on one verdict. */
const EVERYTHING: readonly NamedVerdict[] = [
  {
    name: "alpha",
    state: "MALADE",
    motifs: [
      "bulletin vieux de 1200 s",
      "redemarrage requis — un noyau corrige mais non charge",
      "disque /var occupe a 93 %",
      "memoire disponible a 3 %",
      "4 mise(s) a jour de securite en attente",
      "6 service(s) tournent sur une bibliotheque remplacee",
      "port(s) inattendu(s) : tcp/2222, local/tcp/25, tailnet/udp/41641",
      "port(s) attendu(s) absent(s) : tcp/22",
      "grappe sans quorum (1 vote(s) sur 3) — /etc/pve en lecture seule",
    ],
  },
  {
    name: "beta",
    state: "SOUFFRANT",
    motifs: [
      "nom d'hote attendu non declare — le bulletin n'est pas verifie",
      "horloge en avance de 1000 s",
      "aucun disque recite — on ne sait pas s'ils se remplissent",
      "mises a jour non recitees",
      "services a redemarrer non recites",
      "ports en ecoute non recites",
      "aucun port attendu declare — rien n'est controle",
      "pvecm present mais quorum illisible — on ne sait pas si /etc/pve s'ecrit",
    ],
  },
  { name: "gamma", state: "MALADE", motifs: ["bulletin d'un autre hote (gamma-host) — non juge"] },
  { name: "d1", ...failureVerdict("d1", "cle") },
  { name: "d2", ...failureVerdict("d2", "delai") },
  { name: "d3", ...failureVerdict("d3", "ssh", 255) },
  { name: "d4", ...failureVerdict("d4", "ssh", 1) },
  { name: "d5", ...failureVerdict("d5", "illisible") },
  { name: "d6", state: "MALADE", motifs: ["d6 : memoire totale nulle"] },
];

describe("read back by the security agent (parse-legion.ts)", () => {
  const text = verdictText(EVERYTHING, INSTANT);

  it("none refused: every motif is in the words it accepts", () => {
    expect(() => parseLegionVerdict(text, NOW_MS)).not.toThrow();
  });

  it("each judged motif is the finding it always was", () => {
    const found = parseLegionVerdict(text, NOW_MS).filter((o) => o.target === "alpha");
    expect(found.map((o) => [o.type, o.occurrence])).toEqual([
      ["serveur_autre", "bulletin vieux de # s"],
      ["serveur_redemarrage", "-"],
      ["serveur_disque", "/var"],
      ["serveur_autre", "memoire disponible a # %"],
      ["serveur_maj_securite", "-"],
      ["serveur_services", "-"],
      ["serveur_port", "tcp/2222"],
      ["serveur_port", "local/tcp/25"],
      ["serveur_port", "tailnet/udp/41641"],
      ["serveur_port_absent", "tcp/22"],
      ["serveur_quorum", "-"],
    ]);
    // The operator's proof reads the counts (J6f).
    expect(found.find((o) => o.type === "serveur_services")?.params?.count).toBe("6");
    expect(found.find((o) => o.type === "serveur_maj_securite")?.params?.count).toBe("4");
  });

  it("every host is seen, with its state, by the page's reader too", () => {
    const view = legionView(text, NOW_MS);
    expect(view.state).toBe("MALADE");
    expect(view.stale).toBe(false);
    expect(view.hosts.map((h) => [h.name, h.state])).toEqual(
      EVERYTHING.map((h) => [h.name, h.state]),
    );
    // One line per port on the page: the three unexpected ones are three lines.
    expect(view.hosts[0]?.motifs).toHaveLength(11);
    expect(view.hosts.slice(1).map((h) => h.motifs.length)).toEqual(
      EVERYTHING.slice(1).map((h) => h.motifs.length),
    );
  });

  it("a failure is a finding of its own, never a closed one", () => {
    const failures = parseLegionVerdict(text, NOW_MS).filter((o) => o.target.startsWith("d"));
    expect(failures).toHaveLength(6);
    expect(failures.every((o) => o.type === "serveur_autre" && o.severity === "moyen")).toBe(true);
  });
});
