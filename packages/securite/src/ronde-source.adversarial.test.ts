// Which ronde Cénacle believes (ADR-0040, R3): `[ronde] source` in
// securite.toml. Absent, Legion's, as before; anything else than the two
// words is no source at all — never a silent fall back on the other ronde.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGION_STALE_MS } from "./parse-legion.ts";
import { CENACLE_STALE_MS, parseRondeSource, RONDE_SOURCES } from "./ronde-source.ts";

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

  it("the repository's securite.toml names Legion's, as before R3", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "securite.toml"), "utf8");
    expect(parseRondeSource(text)).toBe("legion");
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
