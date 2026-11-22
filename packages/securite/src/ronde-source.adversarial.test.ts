// Which ronde Cénacle believes (ADR-0040): `[ronde] source` in securite.toml.
// Since R4 (Legion stopped on 22/11/2026) one word only, "cenacle"; anything
// else — "legion" included, the section absent included — is no source at
// all: nothing judged, and never Legion's old verdict by default.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CENACLE_STALE_MS,
  freshSourceVerdict,
  parseRondeSource,
  RONDE_SOURCES,
} from "./ronde-source.ts";

/** Where Legion's reader left its verdict on the Mac: the file may outlive Legion. */
const OLD_LEGION_PATH = `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.legion.ronde.verdict`;

describe("the source securite.toml names", () => {
  it("Cénacle's", () => {
    expect(parseRondeSource('[ronde]\nsource = "cenacle"\n')).toBe("cenacle");
  });

  it.each([
    ["Legion's, now that Legion is stopped", '[ronde]\nsource = "legion"\n'],
    ["no [ronde] at all (Legion's by default, before R4)", "[serveurs]\nactif = true\n"],
    ["an empty [ronde] (Legion's by default, before R4)", "[ronde]\n"],
    ["an empty file", ""],
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
  ])("%s: no source", (_what, text) => {
    expect(parseRondeSource(text)).toBeNull();
  });

  // A switch is a pull request of mine, never a side effect: this line moves with it.
  it("the repository's securite.toml names Cénacle's, since the switch of 22/11/2026", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "securite.toml"), "utf8");
    expect(parseRondeSource(text)).toBe("cenacle");
  });
});

describe("the one source's facts", () => {
  it("Cénacle's alone, at four passes missed (20 minutes), never Legion's file", () => {
    expect(Object.keys(RONDE_SOURCES)).toEqual(["cenacle"]);
    expect(RONDE_SOURCES.cenacle.staleMs).toBe(CENACLE_STALE_MS);
    expect(CENACLE_STALE_MS).toBe(20 * 60_000);
    expect(RONDE_SOURCES.cenacle.path).not.toBe(OLD_LEGION_PATH);
  });
});

describe("the operator's verdict", () => {
  const NOW = 1_794_679_266_000;
  const at = (minutes: number) =>
    `etat=SAIN\ninstant=${Math.floor((NOW - minutes * 60_000) / 1000)}\nhotes=0\nfin=1`;
  const only = (path: string, text: string) => (p: string) => (p === path ? text : null);

  it("a missing securite.toml names no source", () => {
    expect(parseRondeSource(null)).toBeNull();
  });

  it("at Cénacle's limit: 19 minutes fresh, 21 not", () => {
    const cenacle = RONDE_SOURCES.cenacle.path;
    expect(freshSourceVerdict(only(cenacle, at(19)), "cenacle", NOW)).toBe(at(19));
    expect(freshSourceVerdict(only(cenacle, at(21)), "cenacle", NOW)).toBeNull();
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

  it("Legion's verdict left on the Mac, fresh: never read in Cénacle's place", () => {
    expect(freshSourceVerdict(only(OLD_LEGION_PATH, at(1)), "cenacle", NOW)).toBeNull();
  });
});
