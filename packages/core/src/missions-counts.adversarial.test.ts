// The "missions" box (ADR-0031) came after 180 days of journal: older events
// have no "missions" count and must read 0, not make Iris sick. And the model
// never answers "missions": an event saying so is a bug, never a count.
import { describe, expect, it } from "vitest";
import { type AgentEvent, ProjectionError, projectStatus } from "./agent-status.ts";
import { CATEGORIES, MODEL_CATEGORIES } from "./fixtures.ts";

let id = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): AgentEvent => ({
  id: BigInt(++id),
  occurredAt: new Date(0),
  agent: "iris",
  type,
  payload,
});
const fetched = (count: number) => ev("mail.fetched", { count, truncated: false, durationMs: 1 });
const OLD_RULES = { clients_prospects: 1, administratif: 0, bruit: 1, a_trier: 0, remaining: 0 };
const OLD_TOTALS = { clients_prospects: 1, administratif: 0, bruit: 1, a_trier: 0, pending: 0 };

describe("missions counters — before and after the box", () => {
  it("events older than the box count 0 missions", () => {
    const status = projectStatus("iris", [
      fetched(2),
      ev("mail.sorted_by_rules", OLD_RULES),
      ev("mail.totals", OLD_TOTALS),
    ]);
    expect(status.mail?.missions).toBe(0);
  });

  it("new events carry it, and it adds up", () => {
    const status = projectStatus("iris", [
      fetched(5),
      ev("mail.sorted_by_rules", { ...OLD_RULES, missions: 3 }),
    ]);
    expect(status.mail).toMatchObject({ missions: 3, pending: 0 });
  });

  it.each([-1, 1.5, "3", null, Number.NaN])(
    "an invalid missions count (%s) stops the projection, never reads 0",
    (missions) => {
      expect(() =>
        projectStatus("iris", [fetched(2), ev("mail.sorted_by_rules", { ...OLD_RULES, missions })]),
      ).toThrow(ProjectionError);
      expect(() => projectStatus("iris", [ev("mail.totals", { ...OLD_TOTALS, missions })])).toThrow(
        ProjectionError,
      );
    },
  );

  it("more missions than pending mails is refused", () => {
    expect(() =>
      projectStatus("iris", [
        fetched(2),
        ev("mail.sorted_by_rules", { ...OLD_RULES, missions: 1 }),
      ]),
    ).toThrow(ProjectionError);
  });

  it("the model never answers missions: such an event is a bug, not a count", () => {
    expect(() =>
      projectStatus("iris", [
        fetched(1),
        ev("mail.sorted_by_rules", { ...OLD_RULES, clients_prospects: 0, bruit: 0, remaining: 1 }),
        ev("mail.model_sorted", { category: "missions" }),
      ]),
    ).toThrow(ProjectionError);
  });

  it("two lists: the base holds five boxes, the model answers four", () => {
    expect(CATEGORIES).toContain("missions");
    expect(MODEL_CATEGORIES).not.toContain("missions");
    expect(CATEGORIES.filter((c) => c !== "missions")).toEqual([...MODEL_CATEGORIES]);
  });
});
