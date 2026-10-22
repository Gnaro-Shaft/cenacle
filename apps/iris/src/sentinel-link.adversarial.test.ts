// The link to the sentinel on the page: journaled once per change, never at
// every beat (a minute each); the outage's length is right; what is journaled
// projects without an unknown type, so the page never shows the card sick.
import { type AgentEvent, projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { createSentinelLink } from "./sentinel-link.ts";

function world(beats: boolean[]) {
  const events: { agent: string; type: string; payload?: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  let minute = 0;
  const link = createSentinelLink({
    beat: async () => beats[minute] ?? true,
    journal: { append: async (e) => events.push(e) },
    log: { warn: (t) => logs.push(`warn ${t}`), info: (t) => logs.push(`info ${t}`) },
    now: () => new Date(Date.UTC(2026, 9, 22, 12, minute)),
  });
  const run = async () => {
    for (minute = 0; minute < beats.length; minute++) await link.beat();
  };
  return { run, events, logs };
}

const types = (events: { type: string; payload?: Record<string, unknown> }[]) =>
  events.map((e) => (e.type === "state.changed" ? `→${String(e.payload?.to)}` : e.type));

describe("the sentinel link", () => {
  it("a steady link is said once, at the first beat", async () => {
    const w = world([true, true, true, true]);
    await w.run();
    expect(types(w.events)).toEqual(["sentinel.link", "→idle"]);
    expect(w.events[0]?.payload).toEqual({ up: true });
    expect(w.logs).toEqual([]);
  });

  it("an outage is said once when it starts and once when it ends, with its minutes", async () => {
    const w = world([true, false, false, false, true, true]);
    await w.run();
    expect(types(w.events)).toEqual([
      "sentinel.link",
      "→idle",
      "sentinel.unreachable",
      "→error",
      "sentinel.reached",
      "→idle",
    ]);
    expect(w.events.find((e) => e.type === "sentinel.reached")?.payload).toEqual({ minutes: 3 });
    expect(w.logs.filter((l) => l.startsWith("warn"))).toHaveLength(1);
  });

  it("a run that starts during an outage says it, and warns", async () => {
    const w = world([false, false, true]);
    await w.run();
    expect(types(w.events)).toEqual(["sentinel.link", "→error", "sentinel.reached", "→idle"]);
    expect(w.events[0]?.payload).toEqual({ up: false });
    expect(w.logs[0]).toMatch(/injoignable/);
  });

  it("all of it is numbers and booleans, under the sentinel's own name", async () => {
    const w = world([true, false, true]);
    await w.run();
    expect(new Set(w.events.map((e) => e.agent))).toEqual(new Set(["sentinel"]));
    for (const e of w.events) {
      for (const v of Object.values(e.payload ?? {})) {
        expect(["number", "boolean", "string"]).toContain(typeof v);
      }
    }
  });

  it("projects on the page: idle when reached, sick when not, never an unknown type", async () => {
    const w = world([true, false]);
    await w.run();
    const asEvents = (n: number): AgentEvent[] =>
      w.events.slice(0, n).map((e, i) => ({
        id: BigInt(i + 1),
        occurredAt: new Date(0),
        agent: e.agent,
        type: e.type,
        payload: e.payload ?? {},
      }));
    expect(projectStatus("sentinel", asEvents(2)).internal).toBe("idle");
    expect(projectStatus("sentinel", asEvents(4)).internal).toBe("error");
  });
});
