// S2: a beat carries no content and cannot lie about time; an outage is told
// once, a recovery once, and a message that failed to go out is told again.
import { describe, expect, it } from "vitest";
import { BeatError, createWatch, parseBeat } from "./watch.ts";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const MIN = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("parseBeat: exactly { program, at }, honest about time", () => {
  it("accepts a fresh beat", () => {
    expect(parseBeat({ program: "iris", at: NOW.toISOString() }, NOW)).toEqual({
      program: "iris",
      at: NOW,
    });
  });

  it.each([
    [
      "a field more (room for content)",
      { program: "iris", at: NOW.toISOString(), subject: "Devis" },
    ],
    ["no time", { program: "iris" }],
    ["an unknown program", { program: "mallory", at: NOW.toISOString() }],
    ["a beat from the future", { program: "iris", at: at(2 * MIN).toISOString() }],
    ["a replayed old beat", { program: "iris", at: at(-6 * MIN).toISOString() }],
    ["a local time", { program: "iris", at: "2026-10-05T12:00:00+02:00" }],
    ["a number", { program: "iris", at: NOW.getTime() }],
    ["an array", [{ program: "iris", at: NOW.toISOString() }]],
    ["nothing", null],
  ])("refuses %s", (_label, body) => {
    expect(() => parseBeat(body, NOW)).toThrow(BeatError);
  });
});

describe("the watch tells each change once", () => {
  const watch = () => createWatch({ silenceMs: 10 * MIN, startedAt: NOW });
  const beatBoth = (w: ReturnType<typeof watch>, ms: number) => {
    w.beat({ program: "iris", at: at(ms) });
    w.beat({ program: "executor", at: at(ms) });
  };

  it("all beating: nothing to tell", () => {
    const w = watch();
    beatBoth(w, 5 * MIN);
    expect(w.check(at(12 * MIN))).toBeNull();
  });

  it("a Mac that never spoke is down after the silence", () => {
    const w = watch();
    expect(w.check(at(9 * MIN))).toBeNull();
    expect(w.check(at(11 * MIN))).toMatch(/Iris et l'exécuteur/);
  });

  it("one alert per outage, then one message when it is back", () => {
    const w = watch();
    beatBoth(w, 0);
    const alert = w.check(at(11 * MIN));
    expect(alert).toMatch(/🚨/);
    w.told();
    expect(w.check(at(20 * MIN))).toBeNull(); // still down: not again
    beatBoth(w, 21 * MIN);
    expect(w.check(at(21 * MIN))).toMatch(/✅/);
    w.told();
    expect(w.check(at(22 * MIN))).toBeNull();
  });

  it("names the program that stopped, and tells again when the other one stops too", () => {
    const w = watch();
    beatBoth(w, 0);
    w.beat({ program: "iris", at: at(9 * MIN) });
    expect(w.check(at(11 * MIN))).toMatch(/de l'exécuteur/);
    w.told();
    expect(w.check(at(20 * MIN))).toMatch(/Iris et l'exécuteur/);
  });

  it("a message that could not be sent is told again at the next check", () => {
    const w = watch();
    beatBoth(w, 0);
    expect(w.check(at(11 * MIN))).toMatch(/🚨/);
    // Telegram down: told() not called.
    expect(w.check(at(12 * MIN))).toMatch(/🚨/);
  });

  it("an older beat arriving late never moves the clock back", () => {
    const w = watch();
    w.beat({ program: "iris", at: at(9 * MIN) });
    w.beat({ program: "iris", at: at(4 * MIN) });
    w.beat({ program: "executor", at: at(9 * MIN) });
    expect(w.check(at(18 * MIN))).toBeNull();
  });
});
