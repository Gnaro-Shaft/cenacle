// ADR-0047: the house's weekly quality verdict, read by the ronde as a sixth
// source — end to end on the Mac's side: the bulletin's lines, parc.local.toml,
// the judgment (8 days, not 36 hours), the finding read back by the security
// agent (its own title, « moyen »), the second sighting that opens it, its
// catalogue entry. What it would never call SAIN: the house's verdict ill,
// missing, unreadable, 8 days and a second old, or dated ahead. And what it
// must not change: the nightly sources keep 36 hours. Host names here are
// fictional.
import { describe, expect, it } from "vitest";
import { type Bulletin, parseBulletin } from "./bulletin.ts";
import { type BackupState, SOURCE_FACTS } from "./bulletin-backups.ts";
import { fixFor } from "./catalogue.ts";
import { DEBOUNCE_MINUTES, reconcile } from "./lifecycle.ts";
import { parseParkMachines } from "./park-machines.ts";
import { classifyMotif, parseLegionVerdict, VERDICT_MOTIF } from "./parse-legion.ts";
import { BACKUP_STALE_MS, backupMotifs, WEEKLY_STALE_MS } from "./ronde-backups.ts";
import { judge, type MachineExpectation } from "./ronde-rules.ts";
import { CENACLE_STALE_MS } from "./ronde-source.ts";
import { verdictText } from "./ronde-verdict.ts";

const NOW = 1_794_679_266_000;
const DAY = 86_400_000;
const ok = (ageMs: number, verdict: "SAIN" | "MALADE" = "SAIN", motifs = 0): BackupState => ({
  source: "maison",
  read: "ok",
  verdict,
  at: NOW - ageMs,
  since: verdict === "MALADE" ? NOW - ageMs : null,
  motifs,
});
const bulletin = (backups: readonly BackupState[] | null): Bulletin => ({
  version: 3,
  host: "maison-vm",
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
const HOUSE: MachineExpectation = {
  hostname: "maison-vm",
  ports: ["tcp/22"],
  diskWarn: 80,
  diskAlert: 90,
  backups: ["maison"],
};

describe("the bulletin's lines for the house", () => {
  const text = (...lines: string[]) =>
    [
      "bulletin=1",
      "version=3",
      "hote=maison-vm",
      "instant=1794679266",
      "redemarrage=non",
      ...lines,
      "fin=1",
    ].join("\n");

  it("read as any source: verdict, instant, since, how many motifs", () => {
    const b = parseBulletin(
      text(
        "sauvegarde.maison.verdict=MALADE",
        "sauvegarde.maison.instant=1794600000",
        "sauvegarde.maison.depuis=1794000000",
        "sauvegarde.maison.motifs=2",
      ),
    );
    expect(b.backups).toEqual([
      {
        source: "maison",
        read: "ok",
        verdict: "MALADE",
        at: 1_794_600_000_000,
        since: 1_794_000_000_000,
        motifs: 2,
      },
    ]);
  });

  const SAIN = [
    "sauvegarde.maison.verdict=SAIN",
    "sauvegarde.maison.instant=1794600000",
    "sauvegarde.maison.motifs=0",
  ];
  it("SAIN, healthy since nothing: read", () => {
    expect(parseBulletin(text(...SAIN)).backups).toEqual([
      {
        source: "maison",
        read: "ok",
        verdict: "SAIN",
        at: 1_794_600_000_000,
        since: null,
        motifs: 0,
      },
    ]);
  });

  it.each([
    ["a name like it, but not it", "sauvegarde.maison2.verdict=SAIN"],
    ["a field of another source", "sauvegarde.maison.gardes=7"],
    ["a motif's text", "sauvegarde.maison.motif=cout-hebdo-31.20-usd"],
  ])("%s: the whole bulletin unreadable, never half read", (_what, line) => {
    expect(() => parseBulletin(text(...SAIN, line))).toThrow(/unknown key sauvegarde\.maison/);
  });

  it.each([
    [
      "an ISO date for its instant (the old format)",
      "sauvegarde.maison.instant=2026-11-24T17:03:14+00:00",
    ],
    ["no verdict", "sauvegarde.maison.verdict=PEUT-ETRE"],
  ])("%s: the whole bulletin unreadable", (_what, line) => {
    const lines = SAIN.map((l) => (l.split("=")[0] === line.split("=")[0] ? line : l));
    expect(() => parseBulletin(text(...lines))).toThrow(/maison/);
  });

  it("the base lines alone are read: each refusal above is the house's line, never the fixture", () => {
    expect(parseBulletin(text(...SAIN)).backups?.length).toBe(1);
  });
});

describe("the ronde judges it by the week", () => {
  it("SAIN seven days old: still SAIN — a weekly writer, not a nightly one", () => {
    expect(judge("maison", bulletin([ok(7 * DAY)]), HOUSE, NOW)).toEqual({
      state: "SAIN",
      motifs: [],
    });
  });

  it("exactly 8 days old: still within", () => {
    expect(backupMotifs(bulletin([ok(WEEKLY_STALE_MS)]), ["maison"])).toEqual([]);
  });

  it.each([
    ["its verdict ill", [ok(DAY, "MALADE", 2)], "sauvegarde maison MALADE"],
    [
      "8 days and a second old",
      [ok(WEEKLY_STALE_MS + 1000)],
      "sauvegarde maison sans verdict depuis 8 j",
    ],
    ["no verdict on the machine", [], "sauvegarde maison sans verdict"],
    [
      "unreadable (a closed folder, the old date format)",
      [{ source: "maison", read: "illisible" }],
      "sauvegarde maison illisible",
    ],
    ["dated ahead", [ok(-6 * 60_000)], "sauvegarde maison datee du futur"],
  ] as [string, BackupState[], string][])("%s: MALADE, in fixed words", (_what, backups, motif) => {
    expect(judge("maison", bulletin(backups), HOUSE, NOW)).toEqual({
      state: "MALADE",
      motifs: [motif],
    });
  });

  it("a nightly source keeps its 36 hours: the week is the house's alone", () => {
    const dumps = { ...ok(BACKUP_STALE_MS + 1000), source: "copie-dumps" as const };
    expect(backupMotifs(bulletin([dumps]), ["copie-dumps"])).toEqual([
      ["MALADE", "sauvegarde copie-dumps sans verdict depuis 36 h"],
    ]);
  });
});

describe("read back by the security agent", () => {
  it.each([
    ["sauvegarde maison MALADE", "maison-vm : mesure de la maison MALADE"],
    [
      "sauvegarde maison sans verdict depuis 8 j",
      "maison-vm : mesure de la maison sans verdict depuis 8 jours",
    ],
    ["sauvegarde maison illisible", "maison-vm : mesure de la maison illisible"],
  ])("« %s »: its own title, of moderate severity", (motif, title) => {
    expect(motif).toMatch(VERDICT_MOTIF);
    expect(classifyMotif("maison-vm", motif)).toEqual([
      expect.objectContaining({
        type: "sauvegarde",
        occurrence: "maison",
        severity: "moyen",
        title,
      }),
    ]);
  });

  it("a nightly source keeps its title and its severity", () => {
    expect(classifyMotif("alpha", "sauvegarde copie-dumps MALADE")).toEqual([
      expect.objectContaining({
        severity: "eleve",
        title: "alpha : sauvegarde copie-dumps MALADE",
      }),
    ]);
  });

  it("the house MALADE opens a finding at the second sighting, never the first", () => {
    const raw = verdictText(
      [{ name: "maison-vm", state: "MALADE", motifs: ["sauvegarde maison MALADE"] }],
      Math.floor(NOW / 1000),
    );
    const observations = parseLegionVerdict(raw, NOW, CENACLE_STALE_MS);
    const results = [{ check: "legion_ronde", ran: true, observations }];
    const first = reconcile([], results, new Date(NOW));
    const inserted = first.insert.find((o) => o.occurrence === "maison");
    expect(inserted?.title).toBe("maison-vm : mesure de la maison MALADE");
    expect(first.promote).toEqual([]);
    const candidate = {
      id: 1,
      check: "legion_ronde",
      status: "candidat" as const,
      firstSeen: new Date(NOW),
      type: "sauvegarde",
      target: "maison-vm",
      occurrence: "maison",
    };
    const soon = reconcile([candidate], results, new Date(NOW + 60_000));
    expect(soon.promote).toEqual([]);
    const later = reconcile([candidate], results, new Date(NOW + DEBOUNCE_MINUTES * 60_000));
    expect(later.promote.map((p) => p.id)).toEqual([1]);
  });
});

describe("its catalogue entry, its declaration, its facts", () => {
  it("read by hand with sudo: the folder is root's alone", () => {
    const fix = fixFor(
      { type: "sauvegarde", target: "maison-vm", occurrence: "maison" },
      { host: "maison-vm", source: "maison" },
    );
    expect(fix.command).toBe("sudo cat /var/lib/maison/mesure/verdict");
    expect(fix.advice).toMatch(/minuteur du lundi/);
  });

  it("declared in parc.local.toml like any source; a look-alike refused", () => {
    const toml = (list: string) =>
      `known_hosts = "/k/kh"\n[[machine]]\nnom = "maison"\nadresse = "maison.exemple.test"\ncompte = "cenacle"\ncle = "/k/maison-bulletin"\nsauvegardes = ${list}\n`;
    expect(parseParkMachines(toml('["maison"]')).machines[0]?.expect.backups).toEqual(["maison"]);
    expect(() => parseParkMachines(toml('["maison/mesure"]'))).toThrow(/unknown backup source/);
  });

  it("its path is fixed under its own folder; the others keep theirs, nightly", () => {
    expect(SOURCE_FACTS.maison).toMatchObject({
      path: "/var/lib/maison/mesure/verdict",
      rhythm: "weekly",
    });
    for (const [s, f] of Object.entries(SOURCE_FACTS)) {
      if (s === "maison") continue;
      expect(f).toMatchObject({ path: `/var/lib/${s}/verdict`, rhythm: "nightly" });
    }
  });
});
