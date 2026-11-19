// A version 3 bulletin (ADR-0043): the backups on the machine, read whole or
// not at all. A source is either unreadable, or a verdict with its instant
// and its count of motifs — never half said, never in an older version, never
// a source outside the closed list. And none of it reaches the page.
import { describe, expect, it } from "vitest";
import { BulletinError, parseBulletin } from "./bulletin.ts";
import { measuresOnly } from "./ronde-bulletins.ts";

const BASE = [
  "bulletin=1",
  "version=3",
  "hote=alpha",
  "instant=1794900100",
  "disque.1.montage=/",
  "disque.1.pourcent=41",
  "disque.1.kilooctets=30832548",
  "redemarrage=non",
];
/** The base bulletin in a version; a version 1 one says nothing of version 2 either. */
const bulletin = (extra: string[], version = "3") =>
  [
    ...BASE.filter((l) => version !== "1" || l !== "redemarrage=non").map((l) =>
      l === "version=3" ? `version=${version}` : l,
    ),
    ...extra,
    "fin=1",
  ].join("\n");
const SAIN = [
  "sauvegarde.copie-dumps.verdict=SAIN",
  "sauvegarde.copie-dumps.instant=1794900000",
  "sauvegarde.copie-dumps.motifs=0",
];
const MALADE = [
  "sauvegarde.copie-bases.verdict=MALADE",
  "sauvegarde.copie-bases.instant=1794900000",
  "sauvegarde.copie-bases.depuis=1794800000",
  "sauvegarde.copie-bases.motifs=2",
];

describe("the backups of a version 3 bulletin", () => {
  it("are read in the list's order: healthy, ill since, unreadable", () => {
    const b = parseBulletin(
      bulletin([...MALADE, "sauvegarde.myriade-base.lecture=illisible", ...SAIN]),
    );
    expect(b.version).toBe(3);
    expect(b.health).not.toBeNull();
    expect(b.backups).toEqual([
      {
        source: "copie-dumps",
        read: "ok",
        verdict: "SAIN",
        at: 1_794_900_000_000,
        since: null,
        motifs: 0,
      },
      {
        source: "copie-bases",
        read: "ok",
        verdict: "MALADE",
        at: 1_794_900_000_000,
        since: 1_794_800_000_000,
        motifs: 2,
      },
      { source: "myriade-base", read: "illisible" },
    ]);
  });

  it("reads Cénacle's copy (ADR-0044), last in the list", () => {
    const copie = [
      "sauvegarde.copie-cenacle.verdict=MALADE",
      "sauvegarde.copie-cenacle.instant=1794900000",
      "sauvegarde.copie-cenacle.depuis=1794850000",
      "sauvegarde.copie-cenacle.motifs=1",
    ];
    expect(parseBulletin(bulletin([...copie, ...SAIN])).backups).toEqual([
      {
        source: "copie-dumps",
        read: "ok",
        verdict: "SAIN",
        at: 1_794_900_000_000,
        since: null,
        motifs: 0,
      },
      {
        source: "copie-cenacle",
        read: "ok",
        verdict: "MALADE",
        at: 1_794_900_000_000,
        since: 1_794_850_000_000,
        motifs: 1,
      },
    ]);
  });

  it("a machine without backups recites none: an empty list, not null", () => {
    expect(parseBulletin(bulletin([])).backups).toEqual([]);
  });

  it("never reach the page: the measures leave them out", () => {
    const shown = measuresOnly(parseBulletin(bulletin([...SAIN, ...MALADE])));
    expect(JSON.stringify(shown)).not.toContain("sauvegarde");
    expect(Object.keys(shown)).not.toContain("backups");
  });

  it.each([
    ["a source half said (no motifs)", SAIN.slice(0, 2)],
    ["a source half said (no instant)", [SAIN[0] ?? "", SAIN[2] ?? ""]],
    [
      "a verdict out of the two words",
      ["sauvegarde.copie-dumps.verdict=SOUFFRANT", ...SAIN.slice(1)],
    ],
    ["unreadable and a verdict at once", [...SAIN, "sauvegarde.copie-dumps.lecture=illisible"]],
    ["a reading word other than illisible", ["sauvegarde.copie-dumps.lecture=absent"]],
    [
      "ill after its own instant",
      [...MALADE.slice(0, 2), "sauvegarde.copie-bases.depuis=1794900001", MALADE[3] ?? ""],
    ],
    [
      "an instant out of shape",
      [
        "sauvegarde.copie-dumps.verdict=SAIN",
        "sauvegarde.copie-dumps.instant=17949e5",
        "sauvegarde.copie-dumps.motifs=0",
      ],
    ],
    ["a negative count", [...SAIN.slice(0, 2), "sauvegarde.copie-dumps.motifs=-1"]],
    [
      "more motifs than the bulletin may say",
      [...SAIN.slice(0, 2), "sauvegarde.copie-dumps.motifs=1001"],
    ],
    ["a source outside the list", ["sauvegarde.restic.verdict=SAIN"]],
    ["a source named like the copy, but not it", ["sauvegarde.copie-cenacle2.verdict=SAIN"]],
    [
      "a key of the copy's verdict, never recited",
      [
        "sauvegarde.copie-cenacle.verdict=SAIN",
        "sauvegarde.copie-cenacle.instant=1794900000",
        "sauvegarde.copie-cenacle.motifs=0",
        "sauvegarde.copie-cenacle.gardes=7",
      ],
    ],
    [
      "a field outside the list (a motif's text)",
      [...SAIN, "sauvegarde.copie-dumps.motif=rsync vers 192.0.2.7"],
    ],
    ["a source said twice", [...SAIN, SAIN[0] ?? ""]],
  ])("%s: the whole bulletin is unreadable", (_what, extra) => {
    expect(() => parseBulletin(bulletin(extra))).toThrow(BulletinError);
  });

  it.each(["1", "2"])("a backup key in a version %s bulletin is unreadable", (version) => {
    expect(() => parseBulletin(bulletin(SAIN, version))).toThrow(/version 3 key/);
  });

  it("a version 2 bulletin still reads, with no backups", () => {
    const b = parseBulletin(bulletin([], "2"));
    expect(b.version).toBe(2);
    expect(b.backups).toBeNull();
  });

  it("an unknown version is unreadable", () => {
    expect(() => parseBulletin(bulletin([], "4"))).toThrow(/unknown version/);
  });
});
