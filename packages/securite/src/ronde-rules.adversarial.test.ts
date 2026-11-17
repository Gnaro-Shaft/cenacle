// The ronde's rules (ADR-0040, R2), ported from Legion's regles.py: its exact
// words, its thresholds, its jokers — and what it would never call SAIN.
// Cases marked "Legion" are its own tests (tests/test_ronde_*), kept as is.
import { describe, expect, it } from "vitest";
import type { Bulletin } from "./bulletin.ts";
import { failureVerdict, judge, type MachineExpectation, portMotifs } from "./ronde-rules.ts";

const NOW = 1_794_679_266_000;
const BASE: Bulletin = {
  version: 2,
  host: "alpha-host",
  at: NOW,
  uptimeSeconds: 1000,
  load: [10, 10, 10],
  cpus: 2,
  memory: { total: 1000, available: 500 },
  disks: [{ mount: "/", percent: 41, kilobytes: 1000 }],
  health: {
    rebootRequired: false,
    updates: { total: 3, security: 0 },
    servicesToRestart: 0,
    cluster: null,
    ports: [{ scope: "autre", protocol: "tcp", port: 22 }],
  },
  backups: null,
};
const EXPECT: MachineExpectation = {
  hostname: "alpha-host",
  ports: ["tcp/22"],
  diskWarn: 80,
  diskAlert: 90,
};
type Health = NonNullable<Bulletin["health"]>;
const withHealth = (h: Partial<Health>): Bulletin => ({
  ...BASE,
  health: { ...(BASE.health as Health), ...h },
});
const run = (b: Bulletin = BASE, e: Partial<MachineExpectation> = {}, now = NOW) =>
  judge("alpha", b, { ...EXPECT, ...e }, now);

describe("a machine with nothing to say", () => {
  it("SAIN, no motif", () => {
    expect(run()).toEqual({ state: "SAIN", motifs: [] });
  });
});

describe("Legion's words, byte for byte", () => {
  it.each([
    [
      { rebootRequired: true },
      "SOUFFRANT",
      "redemarrage requis — un noyau corrige mais non charge",
    ],
    [{ updates: null }, "SOUFFRANT", "mises a jour non recitees"],
    [
      { updates: { total: 5, security: 3 } },
      "SOUFFRANT",
      "3 mise(s) a jour de securite en attente",
    ],
    [{ servicesToRestart: null }, "SOUFFRANT", "services a redemarrer non recites"],
    [{ servicesToRestart: 6 }, "SOUFFRANT", "6 service(s) tournent sur une bibliotheque remplacee"],
    [{ ports: null }, "SOUFFRANT", "ports en ecoute non recites"],
    [
      { cluster: { quorum: "illisible", votes: null, expected: null } },
      "SOUFFRANT",
      "pvecm present mais quorum illisible — on ne sait pas si /etc/pve s'ecrit",
    ],
    [
      { cluster: { quorum: "non", votes: 1, expected: 3 } },
      "MALADE",
      "grappe sans quorum (1 vote(s) sur 3) — /etc/pve en lecture seule",
    ],
    [
      { cluster: { quorum: "non", votes: null, expected: null } },
      "MALADE",
      "grappe sans quorum — /etc/pve en lecture seule",
    ],
  ] as const)("%j → %s", (health, state, motif) => {
    expect(run(withHealth(health as Partial<Health>))).toEqual({ state, motifs: [motif] });
  });

  it("2 votes of 3 with the quorum: SAIN, on purpose (Legion)", () => {
    const b = withHealth({ cluster: { quorum: "oui", votes: 2, expected: 3 } });
    expect(run(b).state).toBe("SAIN");
  });

  it("no ports declared: nothing is checked, never SAIN", () => {
    expect(run(BASE, { ports: [] })).toEqual({
      state: "SOUFFRANT",
      motifs: ["aucun port attendu declare — rien n'est controle"],
    });
  });

  it("no disk recited", () => {
    expect(run({ ...BASE, disks: [] }).motifs).toEqual([
      "aucun disque recite — on ne sait pas s'ils se remplissent",
    ]);
  });
});

describe("disks: Legion's thresholds, inclusive", () => {
  it.each([
    [79, "SAIN"],
    [80, "SOUFFRANT"],
    [89, "SOUFFRANT"],
    [90, "MALADE"],
    [100, "MALADE"],
  ])("%i %% → %s (Legion)", (percent, state) => {
    const v = run({ ...BASE, disks: [{ mount: "/var", percent, kilobytes: 1 }] });
    expect(v.state).toBe(state);
    expect(v.motifs).toEqual(state === "SAIN" ? [] : [`disque /var occupe a ${percent} %`]);
  });

  it("a machine's own thresholds", () => {
    const disks = [{ mount: "/", percent: 85, kilobytes: 1 }];
    expect(run({ ...BASE, disks }, { diskWarn: 90, diskAlert: 95 }).state).toBe("SAIN");
    expect(run({ ...BASE, disks }, { diskWarn: 70, diskAlert: 85 }).state).toBe("MALADE");
  });

  it("judged in the order of their mount, as Legion's sorted()", () => {
    const disks = [
      { mount: "/var", percent: 85, kilobytes: 1 },
      { mount: "/", percent: 95, kilobytes: 1 },
      { mount: "/boot", percent: 81, kilobytes: 1 },
    ];
    expect(run({ ...BASE, disks }).motifs).toEqual([
      "disque / occupe a 95 %",
      "disque /boot occupe a 81 %",
      "disque /var occupe a 85 %",
    ]);
  });
});

describe("memory", () => {
  it("under 5 % available, floor division as Legion's", () => {
    expect(run({ ...BASE, memory: { total: 1000, available: 49 } }).motifs).toEqual([
      "memoire disponible a 4 %",
    ]);
    expect(run({ ...BASE, memory: { total: 1000, available: 50 } }).state).toBe("SAIN");
  });

  it("no memory at all: MALADE, nothing else judged (Legion)", () => {
    expect(run({ ...BASE, memory: { total: 0, available: 0 } })).toEqual({
      state: "MALADE",
      motifs: ["alpha : memoire totale nulle"],
    });
  });

  it("not recited: not judged (optional for Legion)", () => {
    expect(run({ ...BASE, memory: null }).state).toBe("SAIN");
  });
});

describe("the bulletin's age", () => {
  it("901 s old, or 901 s ahead: said; 900 s: not (Legion's strict >)", () => {
    expect(run(BASE, {}, NOW + 901_000).motifs).toEqual(["bulletin vieux de 901 s"]);
    expect(run(BASE, {}, NOW - 901_000).motifs).toEqual(["horloge en avance de 901 s"]);
    expect(run(BASE, {}, NOW + 900_000).state).toBe("SAIN");
  });
});

describe("whose bulletin it is (not Legion's: ADR-0040)", () => {
  it("another host's bulletin: MALADE, none of its facts judged as this machine's", () => {
    const v = run({ ...withHealth({ rebootRequired: true }), host: "other-host" });
    expect(v).toEqual({
      state: "MALADE",
      motifs: ["bulletin d'un autre hote (other-host) — non juge"],
    });
  });

  it("the same name in other letters is another name", () => {
    expect(run({ ...BASE, host: "Alpha-Host" }).state).toBe("MALADE");
  });

  it("no host name declared: judged, but never SAIN", () => {
    const v = run(BASE, { hostname: null });
    expect(v.state).toBe("SOUFFRANT");
    expect(v.motifs[0]).toBe("nom d'hote attendu non declare — le bulletin n'est pas verifie");
  });
});

describe("a version 1 bulletin: what it does not say is unknown, never fine", () => {
  it("updates, services and ports said as not recited", () => {
    expect(run({ ...BASE, version: 1, health: null }).motifs).toEqual([
      "mises a jour non recitees",
      "services a redemarrer non recites",
      "ports en ecoute non recites",
    ]);
  });
});

describe("the worst wins, every motif kept, in Legion's order", () => {
  it("a full disk and a reboot (Legion): MALADE, both said, reboot first", () => {
    const b = {
      ...withHealth({ rebootRequired: true }),
      disks: [{ mount: "/", percent: 95, kilobytes: 1 }],
    };
    expect(run(b)).toEqual({
      state: "MALADE",
      motifs: ["redemarrage requis — un noyau corrige mais non charge", "disque / occupe a 95 %"],
    });
  });

  it("age, reboot, disks, memory, updates, services, ports, cluster", () => {
    const b: Bulletin = {
      ...BASE,
      memory: { total: 100, available: 1 },
      disks: [{ mount: "/", percent: 80, kilobytes: 1 }],
      health: {
        rebootRequired: true,
        updates: { total: 2, security: 1 },
        servicesToRestart: 2,
        cluster: { quorum: "illisible", votes: null, expected: null },
        ports: [{ scope: "autre", protocol: "tcp", port: 2222 }],
      },
    };
    expect(run(b, {}, NOW + 1_000_000).motifs.map((m) => m.split(" ")[0])).toEqual([
      "bulletin",
      "redemarrage",
      "disque",
      "memoire",
      "1",
      "2",
      "port(s)",
      "port(s)",
      "pvecm",
    ]);
  });
});

describe("ports: Legion's comparison", () => {
  it("tcp/2222 recited where tcp/22 is expected (Legion): both said", () => {
    expect(portMotifs(["tcp/2222"], ["tcp/22"])).toEqual([
      ["MALADE", "port(s) inattendu(s) : tcp/2222"],
      ["SOUFFRANT", "port(s) attendu(s) absent(s) : tcp/22"],
    ]);
  });

  it("sorted and joined as Legion's", () => {
    expect(portMotifs(["udp/53", "tcp/80", "tcp/443"], [])[0]?.[1]).toBe(
      "port(s) inattendu(s) : tcp/443, tcp/80, udp/53",
    );
  });

  it("the same number in another scope is another port", () => {
    expect(portMotifs(["tailnet/tcp/4444"], ["tcp/4444"])).toHaveLength(2);
  });

  it("a joker covering nothing is never missing", () => {
    expect(portMotifs(["tcp/22"], ["tcp/22", "tailnet/tcp/*", "local/tcp/*"])).toEqual([]);
  });

  it.each([
    "tcp/62042",
    "tailnet/udp/62042",
    "tailnet/tcp/",
    "tailnet/tcp/x",
    "tailnet/tcp/62042/tcp/22",
    "tailnet/tcp/６２０４２",
    "local/tailnet/tcp/1",
  ])("tailnet/tcp/* never covers %s (Legion)", (port) => {
    expect(portMotifs([port], ["tailnet/tcp/*"])[0]?.[0]).toBe("MALADE");
  });

  it.each([
    "local/tcp/4444",
    "local/tcp/32767",
    "tcp/41833",
    "tailnet/tcp/41833",
    "local/udp/41833",
    "local/tcp/",
    "local/tcp/x",
    "local/tcp/41833/tcp/22",
    "local/tcp/４１８３３",
  ])("local/tcp/* never covers %s (Legion)", (port) => {
    expect(portMotifs([port], ["local/tcp/*"])[0]?.[0]).toBe("MALADE");
  });

  it("local/tcp/* covers the ephemeral range, from 32768 on", () => {
    expect(portMotifs(["local/tcp/32768", "local/tcp/65535"], ["local/tcp/*"])).toEqual([]);
  });

  it.each(["tcp/*", "local/*", "local/udp/*", "*"])(
    "%s is no joker: it covers nothing (Legion)",
    (joker) => {
      expect(portMotifs(["tcp/4444"], [joker])[0]).toEqual([
        "MALADE",
        "port(s) inattendu(s) : tcp/4444",
      ]);
    },
  );
});

describe("a machine that could not be judged: MALADE, fixed words, never ssh's output", () => {
  it.each([
    ["cle", 0, "alpha : cle du bulletin mal protegee — non utilisee"],
    ["delai", 0, "alpha : injoignable (delai depasse)"],
    ["lancement", 0, "alpha : ssh n'a pas pu etre lance"],
    ["ssh", 255, "alpha : injoignable (ssh a rendu 255)"],
    ["ssh", 1, "alpha : ssh a rendu 1"],
    ["illisible", 0, "alpha : bulletin illisible"],
  ] as const)("%s (%i)", (failure, code, motif) => {
    expect(failureVerdict("alpha", failure, code)).toEqual({ state: "MALADE", motifs: [motif] });
  });
});

describe("a long list of ports: several motifs, each one the security agent can read", () => {
  it("30 unexpected ports: three motifs of 12, 12 and 6, in order, each under 300 characters", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tailnet/tcp/${65_000 + i}`);
    const out = portMotifs(many, ["tcp/22"]);
    const unexpected = out.filter(([s]) => s === "MALADE").map(([, m]) => m);
    expect(unexpected).toHaveLength(3);
    expect(unexpected.map((m) => m.split(", ").length)).toEqual([12, 12, 6]);
    expect(unexpected[0]).toMatch(/^port\(s\) inattendu\(s\) : tailnet\/tcp\/65000, /);
    for (const m of unexpected) expect(m.length).toBeLessThanOrEqual(300);
    expect(out.at(-1)).toEqual(["SOUFFRANT", "port(s) attendu(s) absent(s) : tcp/22"]);
  });

  it("12 ports exactly: still one motif, as Legion writes it", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `tcp/${1000 + i}`);
    expect(portMotifs(twelve, [])).toHaveLength(1);
  });
});
