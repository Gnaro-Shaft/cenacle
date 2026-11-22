// ADR-0043, S2b: the backups in the ronde's file for the page. The ronde
// judges each source once (backupJudgments); its motifs and the page's words
// come from that one judgment, never from two rules that could drift. What
// the file must never do: show an undeclared source as judged, a source
// judged healthy whose verdict is MALADE, a declared source dropped, a
// motif's text. Host names here are fictional.
import { describe, expect, it } from "vitest";
import type { Bulletin } from "./bulletin.ts";
import { BACKUP_SOURCES, type BackupSource, type BackupState } from "./bulletin-backups.ts";
import {
  BACKUP_FUTURE_MS,
  BACKUP_JUDGMENTS,
  BACKUP_STALE_MS,
  backupJudgments,
  backupMotifs,
} from "./ronde-backups.ts";
import {
  MAX_BULLETINS_FILE,
  measuresOnly,
  parseRondeBulletins,
  type RondeBulletins,
  RondeBulletinsError,
} from "./ronde-bulletins.ts";
import { fileBackups } from "./ronde-bulletins-backups.ts";

const NOW = 1_794_679_266_000;
const HOUR = 3_600_000;
const ok = (source: BackupSource, ageMs = HOUR, verdict: "SAIN" | "MALADE" = "SAIN") =>
  ({
    source,
    read: "ok",
    verdict,
    at: NOW - ageMs,
    since: verdict === "MALADE" ? NOW - ageMs - HOUR : null,
    motifs: verdict === "MALADE" ? 2 : 0,
  }) as const;
const unreadable = (source: BackupSource) => ({ source, read: "illisible" }) as const;
const bulletin = (backups: readonly BackupState[] | null): Bulletin => ({
  version: backups === null ? 2 : 3,
  host: "alpha-host",
  at: NOW,
  uptimeSeconds: 1000,
  load: [10, 10, 10],
  cpus: 2,
  memory: { total: 1000, available: 500 },
  disks: [{ mount: "/", percent: 41, kilobytes: 1000 }],
  health: null,
  backups,
});

describe("one judgment per source", () => {
  it("the declared first, in their order, then the recited nobody declared", () => {
    const b = bulletin([ok("copie-dumps"), ok("copie-bases"), ok("myriade-base")]);
    const judged = backupJudgments(b, ["myriade-base", "veiller-sauvegardes"]);
    expect(judged?.map((j) => [j.source, j.judgment])).toEqual([
      ["myriade-base", "sain"],
      ["veiller-sauvegardes", "absente"],
      ["copie-dumps", "non-declaree"],
      ["copie-bases", "non-declaree"],
    ]);
  });

  it.each([
    ["sain", ok("copie-dumps")],
    ["malade", ok("copie-dumps", HOUR, "MALADE")],
    ["illisible", unreadable("copie-dumps")],
    ["perimee", ok("copie-dumps", BACKUP_STALE_MS + 1000)],
    ["future", ok("copie-dumps", -(BACKUP_FUTURE_MS + 1000))],
  ] as const)("declared and %s", (judgment, s) => {
    expect(backupJudgments(bulletin([s]), ["copie-dumps"])?.[0]?.judgment).toBe(judgment);
  });

  it("an undeclared source ill, stale, from the future or unreadable is shown, never judged", () => {
    const b = bulletin([
      ok("copie-dumps", HOUR, "MALADE"),
      ok("copie-bases", BACKUP_STALE_MS * 3),
      ok("myriade-base", -BACKUP_STALE_MS),
      unreadable("copie-cenacle"),
    ]);
    const judged = backupJudgments(b, []);
    expect(judged?.every((j) => j.judgment === "non-declaree")).toBe(true);
    expect(backupMotifs(b, [])).toEqual([]);
  });

  it("a bulletin that recites none (version 2): no judgment at all, never healthy", () => {
    expect(backupJudgments(bulletin(null), ["copie-dumps"])).toBeNull();
    expect(backupJudgments(bulletin(null), [])).toBeNull();
  });

  it("the motifs are the judgment's, for every case: one motif per declared source not sain", () => {
    const cases: BackupState[][] = [
      [],
      [ok("copie-dumps")],
      [ok("copie-dumps", HOUR, "MALADE"), unreadable("copie-bases")],
      [ok("copie-dumps", BACKUP_STALE_MS + 1), ok("myriade-base", -(BACKUP_FUTURE_MS + 1))],
      BACKUP_SOURCES.map((s) => ok(s, HOUR, "MALADE")),
    ];
    const declarations: BackupSource[][] = [[], ["copie-dumps"], [...BACKUP_SOURCES]];
    for (const c of cases) {
      for (const d of declarations) {
        const judged = backupJudgments(bulletin(c), d) ?? [];
        const ill = judged.filter((j) => j.judgment !== "sain" && j.judgment !== "non-declaree");
        const motifs = backupMotifs(bulletin(c), d);
        expect(motifs.map(([, m]) => m.split(" ")[1])).toEqual(ill.map((j) => j.source));
        expect(motifs.every(([state]) => state === "MALADE")).toBe(true);
      }
    }
  });
});

const B3 = bulletin([
  ok("copie-dumps"),
  ok("myriade-base", HOUR, "MALADE"),
  unreadable("copie-bases"),
]);
const DECLARED: BackupSource[] = ["copie-dumps", "veiller-sauvegardes", "myriade-base"];
const FILE: RondeBulletins = {
  at: NOW,
  config: "ok",
  machines: [
    {
      name: "alpha",
      read: "ok",
      bulletin: measuresOnly(B3),
      declared: DECLARED,
      backups: fileBackups(backupJudgments(B3, DECLARED) ?? []),
    },
    { name: "beta", read: "injoignable", declared: ["copie-dumps"] },
    { name: "gamma", read: "ok", bulletin: measuresOnly(B3), declared: [], backups: null },
  ],
};
type Json = Record<string, unknown>;
const edit = (change: (f: Json) => void) => {
  const f = JSON.parse(JSON.stringify(FILE)) as Json;
  change(f);
  return JSON.stringify(f);
};
const alpha = (f: Json) => (f.machines as Json[])[0] as Json;
const backups = (f: Json) => alpha(f).backups as Json[];
const nth = (f: Json, i: number) => backups(f)[i] as Json;

describe("in the file, written then read back", () => {
  it("as written, to the field: the declared, the judged, the unread machine's expectation", () => {
    expect(parseRondeBulletins(JSON.stringify(FILE))).toEqual(FILE);
    expect(FILE.machines[0]).toMatchObject({
      backups: [
        { source: "copie-dumps", judgment: "sain", verdict: "SAIN", motifs: 0 },
        { source: "veiller-sauvegardes", judgment: "absente", verdict: null, at: null },
        { source: "myriade-base", judgment: "malade", verdict: "MALADE", motifs: 2 },
        { source: "copie-bases", judgment: "non-declaree", verdict: null, motifs: null },
      ],
    });
  });

  it("numbers and fixed words only: no motif's text, no path, no command", () => {
    const raw = JSON.stringify(FILE);
    for (const word of ['"motif"', "/var/lib", "cat ", "rsync", "ssh"]) {
      expect(raw).not.toContain(word);
    }
  });

  it("twenty machines of five sources each stay far under the file's limit", () => {
    const all = [...BACKUP_SOURCES];
    const b = bulletin(all.map((s) => ok(s, HOUR, "MALADE")));
    const big: RondeBulletins = {
      at: NOW,
      config: "ok",
      machines: Array.from({ length: 20 }, (_, i) => ({
        name: `machine-${i}`,
        read: "ok" as const,
        bulletin: measuresOnly(b),
        declared: all,
        backups: fileBackups(backupJudgments(b, all) ?? []),
      })),
    };
    expect(parseRondeBulletins(JSON.stringify(big))).toEqual(big);
    expect(JSON.stringify(big).length).toBeLessThan(MAX_BULLETINS_FILE / 4);
  });

  it("every word the ronde writes is one the page can read", () => {
    for (const judgment of BACKUP_JUDGMENTS) {
      const none = judgment === "absente" || judgment === "illisible";
      const raw = edit((f) => {
        const m = alpha(f);
        m.declared = judgment === "non-declaree" ? [] : ["copie-dumps"];
        m.backups = [
          {
            source: "copie-dumps",
            judgment,
            verdict: none ? null : judgment === "malade" ? "MALADE" : "SAIN",
            at: none ? null : NOW,
            since: null,
            motifs: none ? null : 0,
          },
        ];
      });
      expect(() => parseRondeBulletins(raw)).not.toThrow();
    }
  });
});

describe("refused whole", () => {
  it.each([
    [
      "an unread machine without its declared sources",
      edit((f) => delete ((f.machines as Json[])[1] as Json).declared),
    ],
    ["a read machine without its backups", edit((f) => delete alpha(f).backups)],
    [
      "a declared source out of the list",
      edit((f) => Object.assign(alpha(f), { declared: ["restic"] })),
    ],
    [
      // On an unread machine: the duplicate is the only fault.
      "a source declared twice",
      edit((f) =>
        Object.assign((f.machines as Json[])[1] as Json, {
          declared: ["copie-dumps", "copie-dumps"],
        }),
      ),
    ],
    ["a declared source dropped", edit((f) => backups(f).splice(1, 1))],
    // Only the declared kept, the last one gone: nothing else is wrong.
    ["the last declared source dropped", edit((f) => backups(f).splice(2, 2))],
    ["the declared out of order", edit((f) => backups(f).reverse())],
    [
      // Two declared sources swapped, both still judged: only their order is wrong.
      "two declared sources swapped",
      edit((f) => {
        const [first, second] = backups(f);
        backups(f).splice(0, 2, second as Json, first as Json);
      }),
    ],
    [
      "an undeclared source judged",
      edit((f) => Object.assign(nth(f, 3), { judgment: "illisible" })),
    ],
    [
      "a declared source said undeclared",
      edit((f) => Object.assign(nth(f, 0), { judgment: "non-declaree" })),
    ],
    ["a source twice", edit((f) => backups(f).push(nth(f, 3)))],
    ["a judgment of its own", edit((f) => Object.assign(nth(f, 0), { judgment: "ok" }))],
    ["sain, its verdict MALADE", edit((f) => Object.assign(nth(f, 0), { verdict: "MALADE" }))],
    ["malade, its verdict SAIN", edit((f) => Object.assign(nth(f, 2), { verdict: "SAIN" }))],
    [
      "absent, with a verdict",
      edit((f) => Object.assign(nth(f, 1), { verdict: "SAIN", at: NOW, motifs: 0 })),
    ],
    ["a verdict of its own", edit((f) => Object.assign(nth(f, 0), { verdict: "OK" }))],
    ["a verdict with no date", edit((f) => Object.assign(nth(f, 0), { at: null }))],
    ["no verdict, but a date", edit((f) => Object.assign(nth(f, 1), { at: NOW }))],
    ["ill after its judgment", edit((f) => Object.assign(nth(f, 2), { since: NOW + 1 }))],
    ["motifs in text", edit((f) => Object.assign(nth(f, 2), { motifs: "2" }))],
    [
      "a motif's text riding along",
      edit((f) => Object.assign(nth(f, 2), { motif: "rsync: 192.0.2.1" })),
    ],
    ["a fraction of a date", edit((f) => Object.assign(nth(f, 0), { at: 1.5 }))],
    ["backups as an object", edit((f) => Object.assign(alpha(f), { backups: {} }))],
    [
      "more sources than there are",
      edit((f) => Object.assign(alpha(f), { declared: [...BACKUP_SOURCES, "copie-dumps"] })),
    ],
  ])("%s", (_what, raw) => {
    expect(() => parseRondeBulletins(raw)).toThrow(RondeBulletinsError);
  });
});
