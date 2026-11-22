// ADR-0043, S2b: the Parc's « Sauvegardes » section, in the ronde's words.
// What it must never do: show a source green whose machine could not be
// read, colour the section with a source nobody declared, build a command
// for a source outside the closed list, believe an old ronde, or show a
// motif's text. Host names here are fictional.
import { describe, expect, it } from "vitest";
import type { BackupView, ParcView } from "./api.ts";
import { backupsSection } from "./parc-backups.ts";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const HOUR = 3_600_000;
const RONDE = { ronde: "ok", at: NOW - 60_000, stale: false, config: "ok" } as const;
const BULLETIN = {
  host: "alpha",
  at: NOW - 60_000,
  uptimeSeconds: 10,
  load: null,
  cpus: 2,
  memory: null,
  disks: [],
};
const b = (over: Partial<BackupView> & Pick<BackupView, "source" | "judgment">): BackupView => ({
  verdict: "SAIN",
  at: NOW - 15 * HOUR,
  since: null,
  motifs: 0,
  ...over,
});
type Machines = NonNullable<ParcView["machines"]>;
function view(machines: Machines["machines"], over: Partial<Machines> = {}): ParcView {
  return {
    at: new Date(NOW).toISOString(),
    servers: { read: "source", source: null },
    findings: {
      counts: { critique: 0, eleve: 0, moyen: 0, faible: 0, info: 0 },
      setAside: 0,
      open: [],
    },
    lastRound: null,
    sentinel: null,
    machines: { ...RONDE, machines, ...over },
    proxmox: null,
  };
}
const read = (name: string, declared: string[], backups: BackupView[] | null) =>
  ({ name, read: "ok", bulletin: BULLETIN, declared, backups }) as const;
const one = (backup: BackupView, over: Partial<Machines> = {}) =>
  backupsSection(view([read("alpha", [backup.source], [backup])], over), NOW);

describe("the lines, in the ronde's words", () => {
  it("a healthy source: green, its age, no command", () => {
    const s = one(b({ source: "copie-dumps", judgment: "sain" }));
    expect(s.tone).toBe("bon");
    expect(s.note).toBeNull();
    expect(s.lines).toEqual([
      {
        machine: "alpha",
        source: "copie-dumps",
        tone: "bon",
        words: "saine, verdict il y a 15 h",
        judged: true,
        command: null,
      },
    ]);
  });

  it.each([
    [
      "malade",
      { verdict: "MALADE", since: NOW - 2 * HOUR, motifs: 3 },
      "MALADE, tombée il y a 2 h · 3 motifs",
    ],
    ["illisible", { verdict: null, at: null, motifs: null }, "verdict illisible"],
    ["absente", { verdict: null, at: null, motifs: null }, "sans verdict sur la machine"],
    ["perimee", { at: NOW - 40 * HOUR }, "sans verdict depuis 36 h (le dernier il y a 40 h)"],
    ["future", { at: NOW + HOUR }, "verdict daté du futur : horloge fausse, ou verdict forgé"],
  ] as const)(
    "%s: red, the command that reads its motifs on the server",
    (judgment, over, words) => {
      const s = one(b({ source: "copie-dumps", judgment, ...over }));
      expect(s.tone).toBe("mauvais");
      expect(s.lines[0]).toMatchObject({
        tone: "mauvais",
        words,
        judged: true,
        command: "cat /var/lib/copie-dumps/verdict",
      });
    },
  );

  it("an undeclared source, ill: grey, said not judged, no command, never colours the section", () => {
    const s = backupsSection(
      view([
        read(
          "alpha",
          ["copie-dumps"],
          [
            b({ source: "copie-dumps", judgment: "sain" }),
            b({ source: "copie-bases", judgment: "non-declaree", verdict: "MALADE", motifs: 4 }),
          ],
        ),
      ]),
      NOW,
    );
    expect(s.tone).toBe("bon");
    expect(s.lines[1]).toEqual({
      machine: "alpha",
      source: "copie-bases",
      tone: "inconnu",
      words: "non attendue, montrée sans être jugée : MALADE il y a 15 h",
      judged: false,
      command: null,
    });
  });

  it("only undeclared sources: nothing judged, the section unknown, never green", () => {
    const s = backupsSection(
      view([read("alpha", [], [b({ source: "copie-bases", judgment: "non-declaree" })])]),
      NOW,
    );
    expect(s.tone).toBe("inconnu");
  });

  it.each(["injoignable", "illisible", "cle", "autre-hote"] as const)(
    "a machine %s that declares sources: each unknown, never green",
    (how) => {
      const s = backupsSection(
        view([{ name: "alpha", read: how, declared: ["copie-dumps", "myriade-base"] }]),
        NOW,
      );
      expect(s.lines.map((l) => [l.source, l.tone])).toEqual([
        ["copie-dumps", "inconnu"],
        ["myriade-base", "inconnu"],
      ]);
      expect(s.tone).toBe("inconnu");
    },
  );

  it("a bulletin too old to recite them, sources declared: red, one line", () => {
    const s = backupsSection(view([read("alpha", ["copie-dumps"], null)]), NOW);
    expect(s.tone).toBe("mauvais");
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ source: null, tone: "mauvais", command: null });
  });

  it("nothing declared, nothing recited: said, never green", () => {
    const s = backupsSection(view([read("alpha", [], null), read("beta", [], [])]), NOW);
    expect(s.lines).toEqual([]);
    expect(s.tone).toBe("inconnu");
    expect(s.note).toContain("Aucune sauvegarde");
  });

  it("the worst judged line frames the section, over the healthy ones", () => {
    const s = backupsSection(
      view([
        read("alpha", ["copie-dumps"], [b({ source: "copie-dumps", judgment: "sain" })]),
        read("beta", ["copie-dumps"], [b({ source: "copie-dumps", judgment: "perimee" })]),
      ]),
      NOW,
    );
    expect(s.tone).toBe("mauvais");
  });
});

describe("what is never believed", () => {
  it("an old ronde: every line grey, the section unknown, said so — even a red one", () => {
    const ill = b({ source: "copie-dumps", judgment: "malade", verdict: "MALADE" });
    const s = one(ill, { stale: true });
    expect(s.tone).toBe("inconnu");
    expect(s.lines.every((l) => l.tone === "inconnu")).toBe(true);
    expect(s.note).toContain("trop ancienne");
  });

  it.each([
    ["not wired", null],
    ["not read", { ronde: "illisible", at: null, stale: false, config: "absent", machines: [] }],
    [
      "not written yet",
      { ronde: "absente", at: null, stale: false, config: "absent", machines: [] },
    ],
  ] as const)("the ronde's file %s: unknown, no line", (_what, machines) => {
    const s = backupsSection({ ...view([]), machines }, NOW);
    expect(s).toMatchObject({ tone: "inconnu", lines: [] });
    expect(s.note).not.toBeNull();
  });

  it("a source outside the closed list: never a command, whatever it is called", () => {
    for (const source of ["../../etc/shadow", "copie-dumps; rm ~/x", "restic"]) {
      const s = one(b({ source, judgment: "illisible", verdict: null }));
      expect(s.lines[0]?.command).toBeNull();
    }
  });

  it("a judgment the page does not know: unknown, never green", () => {
    const s = one(b({ source: "copie-dumps", judgment: "inconnu" as BackupView["judgment"] }));
    expect(s.lines[0]?.tone).toBe("inconnu");
    expect(s.tone).toBe("inconnu");
  });

  it("no motif's text is ever in a line: their number only", () => {
    const s = one(b({ source: "copie-dumps", judgment: "malade", verdict: "MALADE", motifs: 1 }));
    expect(s.lines[0]?.words).toBe("MALADE, tombée il y a 15 h · 1 motif");
  });
});
