// The operator's state (2026-10-14): three strict lines, read back exactly or
// not at all; nothing said while the actions are switched off; otherwise a
// silent operator (no state, unreadable, from the future, over ten minutes
// old) or a blocked one by kind — high, so it speaks without waiting.
import { describe, expect, it } from "vitest";
import { fixFor } from "./catalogue.ts";
import {
  formatOperatorState,
  OPERATOR_SILENCE_MS,
  operatorObservations,
  parseOperatorState,
} from "./operator-state.ts";
import { SERVERS_CONFIG_PROBLEMS } from "./servers.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const MIN = 60_000;
const state = (config: string, at = NOW) =>
  `instant=${Math.floor(at / 1000)}\nconfig=${config}\nfin=1\n`;

describe("the state file", () => {
  it("reads back what was written, for ok and every kind", () => {
    for (const config of ["ok", ...SERVERS_CONFIG_PROBLEMS] as const) {
      const text = formatOperatorState({ instantMs: NOW, config });
      expect(parseOperatorState(text)).toEqual({ instantMs: NOW, config });
    }
  });

  it.each([
    ["cut short", "instant=1791979200\nconfig=ok\n"],
    ["no end mark at all", "instant=1791979200\nconfig=ok"],
    ["an unknown kind", state("illisible")],
    ["a kind in capitals", state("CLES")],
    ["a value after the kind", state("ok vps-b.exemple.test")],
    ["a line more", `${state("ok")}adresse=vps-b.exemple.test\n`],
    ["lines in another order", "config=ok\ninstant=1791979200\nfin=1\n"],
    ["Windows line ends", state("ok").replaceAll("\n", "\r\n")],
    ["a space before", ` ${state("ok")}`],
    ["an instant too long", state("ok").replace(/instant=\d+/, "instant=1234567890123")],
    ["empty", ""],
  ])("refuses %s", (_label, text) => {
    expect(parseOperatorState(text)).toBeNull();
  });
});

describe("what the security agent sees", () => {
  it("nothing while the actions are switched off, whatever the state", () => {
    for (const text of [null, "", state("cles"), state("ok", NOW - 60 * MIN)]) {
      expect(operatorObservations(text, false, NOW)).toEqual([]);
    }
  });

  it("nothing when the operator said ok within ten minutes, to the second", () => {
    expect(operatorObservations(state("ok"), true, NOW)).toEqual([]);
    expect(operatorObservations(state("ok", NOW - OPERATOR_SILENCE_MS), true, NOW)).toEqual([]);
  });

  it.each([
    ["no state", null, "aucun état publié"],
    ["an unreadable state", "instant=x\n", "état illisible"],
    ["a state from the future", state("ok", NOW + 6 * MIN), "état illisible"],
    [
      "a state just over ten minutes old",
      state("ok", NOW - OPERATOR_SILENCE_MS - 1000),
      "plus de 10 minutes",
    ],
    ["a blocked state, but old", state("cles", NOW - 11 * MIN), "plus de 10 minutes"],
  ])("a silent operator: %s", (_label, text, why) => {
    const seen = operatorObservations(text, true, NOW);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: "operateur_silencieux",
      target: "operateur",
      occurrence: "-",
      severity: "eleve",
    });
    expect(seen[0]?.title).toContain(why);
  });

  it("a state four minutes ahead (clock drift) still counts", () => {
    expect(operatorObservations(state("ok", NOW + 4 * MIN), true, NOW)).toEqual([]);
  });

  it.each(SERVERS_CONFIG_PROBLEMS)(
    "blocked by %s: one high finding, the kind as occurrence",
    (problem) => {
      const seen = operatorObservations(state(problem), true, NOW);
      expect(seen).toEqual([
        expect.objectContaining({
          type: "operateur_config",
          target: "serveurs.local.toml",
          occurrence: problem,
          severity: "eleve",
          params: { problem },
        }),
      ]);
      expect(seen[0]?.title).toMatch(
        /^Les actions sur les serveurs sont bloquées : l'opérateur refuse serveurs\.local\.toml \(.+\)$/,
      );
    },
  );

  it("each kind reads differently in the title", () => {
    const titles = new Set(
      SERVERS_CONFIG_PROBLEMS.map((p) => operatorObservations(state(p), true, NOW)[0]?.title),
    );
    expect(titles.size).toBe(SERVERS_CONFIG_PROBLEMS.length);
  });

  it("both kinds of finding have their fix in the catalogue, a command to run myself", () => {
    const config = { type: "operateur_config", target: "serveurs.local.toml", occurrence: "cles" };
    expect(fixFor(config).command).toBe("npm run serveurs:verifier");
    const silent = { type: "operateur_silencieux", target: "operateur", occurrence: "-" };
    expect(fixFor(silent).command).toBe("launchctl list | grep org.cenacle.operateur");
  });
});
