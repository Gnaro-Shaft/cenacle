// Which ronde Cénacle believes (ADR-0040, R3): `[ronde] source` in
// securite.toml. Absent, Legion's, as before; anything else than the two
// words is no source at all — never a silent fall back on the other ronde.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGION_STALE_MS } from "./parse-legion.ts";
import {
  CENACLE_STALE_MS,
  freshSourceVerdict,
  parseRondeSource,
  RONDE_SOURCES,
} from "./ronde-source.ts";

describe("the source securite.toml names", () => {
  it.each([
    ["no [ronde] at all", "[serveurs]\nactif = true\n", "legion"],
    ["an empty [ronde]", "[ronde]\n", "legion"],
    ["Legion's", '[ronde]\nsource = "legion"\n', "legion"],
    ["Cénacle's", '[ronde]\nsource = "cenacle"\n', "cenacle"],
    ["an empty file", "", "legion"],
  ] as const)("%s → %s", (_what, text, source) => {
    expect(parseRondeSource(text)).toBe(source);
  });

  it.each([
    ["a typo", '[ronde]\nsource = "cenacel"\n'],
    ["another case", '[ronde]\nsource = "Cenacle"\n'],
    ["the accent", '[ronde]\nsource = "cénacle"\n'],
    ["a space", '[ronde]\nsource = "cenacle "\n'],
    ["empty", '[ronde]\nsource = ""\n'],
    ["a list", '[ronde]\nsource = ["cenacle"]\n'],
    ["a boolean", "[ronde]\nsource = true\n"],
    ["a key of its own", '[ronde]\nsource = "cenacle"\nsecours = "legion"\n'],
    ["[ronde] not a table", 'ronde = "cenacle"\n'],
    ["a file that does not parse", '[ronde\nsource = "cenacle"\n'],
    ["[ronde] twice", '[ronde]\nsource = "legion"\n[ronde]\nsource = "cenacle"\n'],
  ])("%s: no source, never the other ronde", (_what, text) => {
    expect(parseRondeSource(text)).toBeNull();
  });

  // A switch is a pull request of mine, never a side effect: this line moves with it.
  it("the repository's securite.toml names Cénacle's, since the switch of 22/11/2026", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "securite.toml"), "utf8");
    expect(parseRondeSource(text)).toBe("cenacle");
  });
});

describe("each source's facts", () => {
  it("Legion at its 45 minutes, Cénacle at four passes missed (20 minutes)", () => {
    expect(RONDE_SOURCES.legion.staleMs).toBe(LEGION_STALE_MS);
    expect(RONDE_SOURCES.cenacle.staleMs).toBe(CENACLE_STALE_MS);
    expect(CENACLE_STALE_MS).toBe(20 * 60_000);
    expect(RONDE_SOURCES.legion.path).not.toBe(RONDE_SOURCES.cenacle.path);
  });
});

describe("what the review found (R3)", () => {
  it("a missing securite.toml names no source: never Legion by default", () => {
    expect(parseRondeSource(null)).toBeNull();
  });

  const NOW = 1_794_679_266_000;
  const at = (minutes: number) =>
    `etat=SAIN\ninstant=${Math.floor((NOW - minutes * 60_000) / 1000)}\nhotes=0\nfin=1`;
  const only = (path: string, text: string) => (p: string) => (p === path ? text : null);

  it("the operator's verdict: at its own source's limit, the tighter one winning", () => {
    const cenacle = RONDE_SOURCES.cenacle.path;
    const legion = RONDE_SOURCES.legion.path;
    expect(freshSourceVerdict(only(cenacle, at(19)), "cenacle", NOW)).toBe(at(19));
    expect(freshSourceVerdict(only(cenacle, at(21)), "cenacle", NOW)).toBeNull();
    // Legion's 45 minutes: 21 is fresh for it (the operator's own 35 still applies after).
    expect(freshSourceVerdict(only(legion, at(21)), "legion", NOW)).toBe(at(21));
  });

  it("no source: nothing read at all; no file: nothing", () => {
    let reads = 0;
    const read = () => {
      reads++;
      return at(1);
    };
    expect(freshSourceVerdict(read, null, NOW)).toBeNull();
    expect(reads).toBe(0);
    expect(freshSourceVerdict(() => null, "cenacle", NOW)).toBeNull();
  });

  it("the other source's file is never read in its place", () => {
    const legionOnly = only(RONDE_SOURCES.legion.path, at(1));
    expect(freshSourceVerdict(legionOnly, "cenacle", NOW)).toBeNull();
  });
});
