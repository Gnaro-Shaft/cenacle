// The two rondes compared (ADR-0040, R3): every real difference is one
// finding, said in plain words; what only differs in wording — ssh's errors
// quoted by Legion, ports in several motifs — is no difference; a verdict
// missing or too old for its own source proves nothing, never "no difference".
import { describe, expect, it } from "vitest";
import { compareVerdicts, DIFFERENCE } from "./ronde-compare.ts";

const NOW_S = 1_794_679_266;
const NOW = NOW_S * 1000;
type Host = [string, ...string[]];

/** A verdict in Legion's format, `minutes` old. */
function verdict(hosts: Record<string, Host>, minutes = 1): string {
  const names = Object.keys(hosts);
  const lines = ["etat=SOUFFRANT", `instant=${NOW_S - minutes * 60}`, `hotes=${names.length}`];
  for (const name of names) {
    const [state, ...motifs] = hosts[name] ?? ["SAIN"];
    lines.push(`${name}.etat=${state}`);
    motifs.forEach((m, i) => {
      lines.push(`${name}.motif${i + 1}=${m}`);
    });
  }
  return [...lines, "fin=1"].join("\n");
}

const services = (n: number) => `${n} service(s) tournent sur une bibliotheque remplacee`;
const same: Record<string, Host> = { alpha: ["SOUFFRANT", services(4)], beta: ["SAIN"] };
const titles = (l: string, c: string) => compareVerdicts(l, c, NOW).map((o) => o.title);

describe("no difference", () => {
  it("the same verdict on both sides", () => {
    expect(compareVerdicts(verdict(same), verdict(same), NOW)).toEqual([]);
  });

  it("the same ports, in one motif for Legion and in two for Cénacle", () => {
    const ports = Array.from({ length: 14 }, (_, i) => `tcp/${1000 + i}`);
    const legion = verdict({ alpha: ["MALADE", `port(s) inattendu(s) : ${ports.join(", ")}`] });
    const cenacle = verdict({
      alpha: [
        "MALADE",
        `port(s) inattendu(s) : ${ports.slice(0, 12).join(", ")}`,
        `port(s) inattendu(s) : ${ports.slice(12).join(", ")}`,
      ],
    });
    expect(compareVerdicts(legion, cenacle, NOW)).toEqual([]);
  });

  it("a machine out of reach, in Legion's words and in Cénacle's: same state, no difference", () => {
    const legion = verdict({
      alpha: ["MALADE", "alpha : ssh a rendu 255 — ssh: connect to host port 22: No route to host"],
    });
    const cenacle = verdict({ alpha: ["MALADE", "alpha : injoignable (ssh a rendu 255)"] });
    expect(compareVerdicts(legion, cenacle, NOW)).toEqual([]);
  });

  it("a number that differs (4 then 5 services) is no new kind of difference", () => {
    const five: Record<string, Host> = { ...same, alpha: ["SOUFFRANT", services(5)] };
    expect(compareVerdicts(verdict(same), verdict(five), NOW)).toEqual([]);
  });
});

describe("each difference, one finding", () => {
  it("a machine judged by one ronde only", () => {
    const legion = verdict({ ...same, "docker-stack": ["SOUFFRANT"] });
    expect(compareVerdicts(legion, verdict(same), NOW)).toEqual([
      {
        type: DIFFERENCE,
        target: "docker-stack",
        occurrence: "machine:legion",
        severity: "info",
        title: "docker-stack : jugée seulement par la ronde de Legion",
        params: { host: "docker-stack" },
      },
    ]);
  });

  it("another state: said with both words", () => {
    const cenacle = verdict({ ...same, beta: ["MALADE", "beta : injoignable (delai depasse)"] });
    expect(titles(verdict(same), cenacle)).toEqual([
      "beta : Legion la dit SAIN, Cénacle la dit MALADE",
    ]);
  });

  it("Legion's fail2ban motif: no typed difference, but the state that it changes", () => {
    const legion = verdict({
      ...same,
      beta: ["SOUFFRANT", "le bulletin ne dit rien des tentatives de connexion"],
    });
    expect(titles(legion, verdict(same))).toEqual([
      "beta : Legion la dit SOUFFRANT, Cénacle la dit SAIN",
    ]);
  });

  it("a port seen by one side only, and one by the other: two findings, each side named", () => {
    const legion = verdict({ ...same, beta: ["MALADE", "port(s) inattendu(s) : tcp/4444"] });
    const cenacle = verdict({
      ...same,
      beta: ["SOUFFRANT", "port(s) attendu(s) absent(s) : tcp/443"],
    });
    const found = compareVerdicts(legion, cenacle, NOW);
    expect(found.map((o) => [o.occurrence, o.title])).toEqual([
      ["etat", "beta : Legion la dit MALADE, Cénacle la dit SOUFFRANT"],
      ["serveur_port:tcp/4444:legion", "beta : port inattendu tcp/4444 — vu seulement par Legion"],
      [
        "serveur_port_absent:tcp/443:cenacle",
        "beta : port attendu absent tcp/443 — vu seulement par Cénacle",
      ],
    ]);
    expect(found.every((o) => o.severity === "info")).toBe(true);
  });

  it("a reboot, updates, the quorum seen by one side: each said; a disk seen by both: not", () => {
    const legion = verdict({
      alpha: [
        "MALADE",
        "redemarrage requis — un noyau corrige mais non charge",
        "2 mise(s) a jour de securite en attente",
        "disque /var occupe a 93 %",
        "grappe sans quorum (1 vote(s) sur 3) — /etc/pve en lecture seule",
      ],
    });
    const cenacle = verdict({ alpha: ["MALADE", "disque /var occupe a 93 %"] });
    expect(compareVerdicts(legion, cenacle, NOW).map((o) => o.occurrence)).toEqual([
      "serveur_redemarrage:-:legion",
      "serveur_maj_securite:-:legion",
      "serveur_quorum:-:legion",
    ]);
  });
});

describe("proves nothing: thrown, never « no difference »", () => {
  it.each([
    ["Cénacle's verdict 21 minutes old", verdict(same), verdict(same, 21)],
    ["Legion's verdict 46 minutes old", verdict(same, 46), verdict(same)],
    ["Cénacle's verdict cut short", verdict(same), verdict(same).replace("\nfin=1", "")],
    ["Legion's verdict empty", "", verdict(same)],
    ["Cénacle's verdict from the future", verdict(same), verdict(same, -10)],
  ])("%s", (_what, legion, cenacle) => {
    expect(() => compareVerdicts(legion, cenacle, NOW)).toThrow();
  });

  it("each at its own limit: Legion 40 minutes old and Cénacle 19 still compare", () => {
    expect(compareVerdicts(verdict(same, 40), verdict(same, 19), NOW)).toEqual([]);
  });
});

describe("an occurrence the findings' table can hold (60 characters)", () => {
  const long = (n: number) => `/${"m".repeat(n)}`;
  it("a disk on a long mount, seen by one side: bounded, stable, and two mounts stay two", () => {
    const legion = verdict({
      alpha: ["MALADE", `disque ${long(95)} occupe a 95 %`, `disque ${long(96)} occupe a 95 %`],
    });
    const cenacle = verdict({ alpha: ["MALADE"] });
    const first = compareVerdicts(legion, cenacle, NOW).map((o) => o.occurrence);
    expect(first).toHaveLength(2);
    for (const o of first) expect(o.length).toBeLessThanOrEqual(60);
    expect(new Set(first).size).toBe(2);
    expect(compareVerdicts(legion, cenacle, NOW).map((o) => o.occurrence)).toEqual(first);
  });

  it("a short one stays readable", () => {
    const legion = verdict({ alpha: ["MALADE", "disque /var occupe a 95 %"] });
    const cenacle = verdict({ alpha: ["MALADE"] });
    expect(compareVerdicts(legion, cenacle, NOW)[0]?.occurrence).toBe("serveur_disque:/var:legion");
  });
});
