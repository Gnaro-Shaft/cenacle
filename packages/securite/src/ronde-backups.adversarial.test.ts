// ADR-0043, S2: the backups judged by Cénacle's ronde, end to end — the
// declared sources in parc.local.toml, the judgment against the bulletin's
// own clock, the motif read back by the security agent as a `sauvegarde`
// finding in fixed words, its catalogue entry, and the operator's proof.
// What it would never call SAIN: a declared source missing, unreadable, ill,
// 36 hours and a second old, five minutes and a second ahead, or a bulletin
// too old to recite any. Host names here are fictional.
import { describe, expect, it } from "vitest";
import type { Bulletin } from "./bulletin.ts";
import { BACKUP_SOURCES, type BackupSource, type BackupState } from "./bulletin-backups.ts";
import { fixFor } from "./catalogue.ts";
import { parseParkMachines } from "./park-machines.ts";
import { classifyMotif, parseLegionVerdict, VERDICT_MOTIF } from "./parse-legion.ts";
import { BACKUP_FUTURE_MS, BACKUP_STALE_MS, backupMotifs } from "./ronde-backups.ts";
import { judge, type MachineExpectation } from "./ronde-rules.ts";
import { CENACLE_STALE_MS } from "./ronde-source.ts";
import { verdictText } from "./ronde-verdict.ts";
import { hostAnswered } from "./servers.ts";

const NOW = 1_794_679_266_000;
const ok = (source: BackupSource, ageMs = 3_600_000, verdict: "SAIN" | "MALADE" = "SAIN") =>
  ({ source, read: "ok", verdict, at: NOW - ageMs, since: null, motifs: 0 }) as const;
const bulletin = (backups: readonly BackupState[] | null, version: 2 | 3 = 3): Bulletin => ({
  version,
  host: "alpha-host",
  at: NOW,
  uptimeSeconds: 1000,
  load: [10, 10, 10],
  cpus: 2,
  memory: { total: 1000, available: 500 },
  disks: [{ mount: "/", percent: 41, kilobytes: 1000 }],
  health: {
    rebootRequired: false,
    updates: { total: 0, security: 0 },
    servicesToRestart: 0,
    cluster: null,
    ports: [{ scope: "autre", protocol: "tcp", port: 22 }],
  },
  backups,
});
const expect_ = (backups: readonly BackupSource[]): MachineExpectation => ({
  hostname: "alpha-host",
  ports: ["tcp/22"],
  diskWarn: 80,
  diskAlert: 90,
  backups,
});
const DUMPS: readonly BackupSource[] = ["copie-dumps"];

describe("the ronde judges the declared sources", () => {
  it("all declared sources healthy and fresh: the machine stays SAIN, no motif", () => {
    const b = bulletin([ok("copie-dumps"), ok("veiller-sauvegardes")]);
    expect(judge("alpha", b, expect_(["copie-dumps", "veiller-sauvegardes"]), NOW)).toEqual({
      state: "SAIN",
      motifs: [],
    });
  });

  it.each([
    ["ill", [ok("copie-dumps", 3_600_000, "MALADE")], "sauvegarde copie-dumps MALADE"],
    ["missing", [ok("veiller-sauvegardes")], "sauvegarde copie-dumps sans verdict"],
    ["recited none (version 3, nothing on the machine)", [], "sauvegarde copie-dumps sans verdict"],
    [
      "unreadable",
      [{ source: "copie-dumps", read: "illisible" }],
      "sauvegarde copie-dumps illisible",
    ],
    [
      "36 hours and a second old",
      [ok("copie-dumps", BACKUP_STALE_MS + 1000)],
      "sauvegarde copie-dumps sans verdict depuis 36 h",
    ],
    [
      "five minutes and a second ahead",
      [ok("copie-dumps", -BACKUP_FUTURE_MS - 1000)],
      "sauvegarde copie-dumps datee du futur",
    ],
  ] as [string, BackupState[], string][])("%s: MALADE, in fixed words", (_what, backups, motif) => {
    const v = judge("alpha", bulletin(backups), expect_(DUMPS), NOW);
    expect(v).toEqual({ state: "MALADE", motifs: [motif] });
  });

  it("exactly 36 hours old, exactly five minutes ahead: still within", () => {
    expect(backupMotifs(bulletin([ok("copie-dumps", BACKUP_STALE_MS)]), DUMPS)).toEqual([]);
    expect(backupMotifs(bulletin([ok("copie-dumps", -BACKUP_FUTURE_MS)]), DUMPS)).toEqual([]);
  });

  it("measured against the bulletin's clock, never the Mac's", () => {
    // The Mac far ahead: the bulletin itself is old, the backup fresh for it.
    const b = { ...bulletin([ok("copie-dumps", 3_600_000)]), at: NOW };
    expect(backupMotifs(b, DUMPS)).toEqual([]);
    const late = judge("alpha", b, expect_(DUMPS), NOW + 3 * 86_400_000);
    expect(late.motifs.filter((m) => m.startsWith("sauvegarde"))).toEqual([]);
  });

  it("a bulletin too old to recite backups (version 2), sources declared: MALADE", () => {
    expect(judge("alpha", bulletin(null, 2), expect_(DUMPS), NOW)).toEqual({
      state: "MALADE",
      motifs: ["sauvegardes non recitees — bulletin trop ancien"],
    });
  });

  it("nothing declared: never judged, whatever the bulletin says", () => {
    const sick = bulletin([
      ok("copie-dumps", 9 * 86_400_000, "MALADE"),
      { source: "copie-bases", read: "illisible" },
    ]);
    expect(judge("alpha", sick, expect_([]), NOW).state).toBe("SAIN");
    expect(judge("alpha", bulletin(null, 2), expect_([]), NOW).state).toBe("SAIN");
  });

  it("a source present but not declared is shown elsewhere, never judged", () => {
    const b = bulletin([ok("copie-dumps"), ok("copie-bases", 9 * 86_400_000, "MALADE")]);
    expect(backupMotifs(b, DUMPS)).toEqual([]);
  });

  it("several declared: each said, in the declared order, after Legion's motifs", () => {
    const b = { ...bulletin([ok("copie-cenacle", 3_600_000, "MALADE")]) };
    const disk = { ...b, disks: [{ mount: "/", percent: 95, kilobytes: 1000 }] };
    const v = judge("alpha", disk, expect_(["myriade-base", "copie-cenacle"]), NOW);
    expect(v.motifs).toEqual([
      "disque / occupe a 95 %",
      "sauvegarde myriade-base sans verdict",
      "sauvegarde copie-cenacle MALADE",
    ]);
  });
});

describe("read back by the security agent: a `sauvegarde` finding, in fixed words", () => {
  it.each([
    ["sauvegarde copie-dumps MALADE", "copie-dumps", "alpha : sauvegarde copie-dumps MALADE"],
    [
      "sauvegarde veiller-sauvegardes illisible",
      "veiller-sauvegardes",
      "alpha : sauvegarde veiller-sauvegardes illisible",
    ],
    [
      "sauvegarde myriade-base sans verdict",
      "myriade-base",
      "alpha : sauvegarde myriade-base sans verdict",
    ],
    [
      "sauvegarde copie-cenacle sans verdict depuis 36 h",
      "copie-cenacle",
      "alpha : sauvegarde copie-cenacle sans verdict depuis 36 h",
    ],
    [
      "sauvegarde copie-dumps datee du futur",
      "copie-dumps",
      "alpha : sauvegarde copie-dumps datée du futur",
    ],
    [
      "sauvegardes non recitees — bulletin trop ancien",
      "bulletin",
      "alpha : sauvegardes non récitées (bulletin trop ancien)",
    ],
  ])("« %s »", (motif, occurrence, title) => {
    expect(classifyMotif("alpha", motif)).toEqual([
      expect.objectContaining({
        type: "sauvegarde",
        target: "alpha",
        occurrence,
        severity: "eleve",
        title,
      }),
    ]);
  });

  it("anything else that looks like it is never a backup finding: no source of its own", () => {
    for (const motif of [
      "sauvegarde copie-dumps MALADE depuis 3 jours",
      "sauvegarde inventee MALADE",
      "sauvegarde copie-dumps",
      "Sauvegarde copie-dumps MALADE",
    ]) {
      expect(classifyMotif("alpha", motif).map((o) => o.type)).toEqual(["serveur_autre"]);
    }
  });

  it("the ronde's verdict round trip: every backup motif in the verdict's alphabet, read back", () => {
    const everything = bulletin([
      ok("copie-dumps", 3_600_000, "MALADE"),
      { source: "veiller-sauvegardes", read: "illisible" },
      ok("copie-cenacle", BACKUP_STALE_MS + 1000),
      ok("myriade-base", -BACKUP_FUTURE_MS - 1000),
    ]);
    const declared: BackupSource[] = [
      "copie-dumps",
      "veiller-sauvegardes",
      "copie-bases",
      "copie-cenacle",
      "myriade-base",
    ];
    const v = judge("alpha", everything, expect_(declared), NOW);
    for (const m of v.motifs) expect(m).toMatch(VERDICT_MOTIF);
    const text = verdictText([{ name: "alpha", ...v }], Math.floor(NOW / 1000));
    expect(text).not.toContain("hors forme");
    const found = parseLegionVerdict(text, NOW, CENACLE_STALE_MS).filter(
      (o) => o.type === "sauvegarde",
    );
    expect(found.map((o) => o.occurrence).sort()).toEqual([...declared].sort());
  });
});

describe("its catalogue entry: read on the server, never a command out of the list", () => {
  it("a source: the command reads its verdict", () => {
    const fix = fixFor(
      { type: "sauvegarde", target: "alpha", occurrence: "copie-dumps" },
      { host: "alpha", source: "copie-dumps" },
    );
    expect(fix.command).toBe("cat /var/lib/copie-dumps/verdict");
    expect(fix.advice).toMatch(/^Sur alpha : /);
  });

  it.each(["../../etc/shadow", "copie-dumps; rm -rf /", "", "inventee"])(
    "a source out of the list (%s): no command",
    (source) => {
      expect(
        fixFor({ type: "sauvegarde", target: "alpha", occurrence: "x" }, { host: "alpha", source })
          .command,
      ).toBeNull();
    },
  );

  it("a bulletin too old: update it, no command", () => {
    const fix = fixFor(
      { type: "sauvegarde", target: "alpha", occurrence: "bulletin" },
      { host: "alpha" },
    );
    expect(fix.command).toBeNull();
    expect(fix.advice).toMatch(/version 3/);
  });
});

describe("the operator's proof: a machine ill for its backups alone did answer", () => {
  const verdictOf = (motifs: string[]) =>
    verdictText([{ name: "alpha", state: "MALADE", motifs }], Math.floor(NOW / 1000));

  it("MALADE for a backup only: answered — never « not back after a reboot »", () => {
    const raw = verdictOf(["sauvegarde copie-dumps MALADE"]);
    expect(hostAnswered(raw, parseLegionVerdict(raw, NOW, CENACLE_STALE_MS), "alpha")).toBe(true);
  });

  it("MALADE for a bulletin it could not read: not answered, as before", () => {
    const raw = verdictOf(["bulletin illisible — non juge"]);
    expect(hostAnswered(raw, parseLegionVerdict(raw, NOW, CENACLE_STALE_MS), "alpha")).toBe(false);
  });
});

describe("the declared sources in parc.local.toml", () => {
  const machine = (extra: string) => `
known_hosts = "/k/known_hosts"

[[machine]]
nom = "alpha"
adresse = "alpha.exemple.test"
compte = "cenacle"
cle = "/k/alpha-bulletin"
${extra}
`;

  it("declared from the closed list, in their order", () => {
    const text = machine('sauvegardes = ["copie-cenacle", "copie-dumps"]');
    expect(parseParkMachines(text).machines[0]?.expect.backups).toEqual([
      "copie-cenacle",
      "copie-dumps",
    ]);
  });

  it("none declared: none judged", () => {
    expect(parseParkMachines(machine("")).machines[0]?.expect.backups).toEqual([]);
    expect(parseParkMachines(machine("sauvegardes = []")).machines[0]?.expect.backups).toEqual([]);
  });

  it.each([
    ["an unknown source", 'sauvegardes = ["copie-secrete"]', /unknown backup source/],
    ["a source twice", 'sauvegardes = ["copie-dumps", "copie-dumps"]', /copie-dumps twice/],
    ["not a list", 'sauvegardes = "copie-dumps"', /list of known sources/],
    ["a number", "sauvegardes = [1]", /unknown backup source/],
    [
      "more than there are sources",
      `sauvegardes = [${Array(BACKUP_SOURCES.length + 1)
        .fill('"copie-dumps"')
        .join(", ")}]`,
      /list of known sources/,
    ],
  ])("%s: the whole file refused, the text never echoed", (_what, line, said) => {
    const run = () => parseParkMachines(machine(line));
    expect(run).toThrow(said);
    expect(run).not.toThrow(/secrete/);
  });
});
