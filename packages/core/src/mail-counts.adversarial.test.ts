// The counters are built from the journal: an event that does not add up must
// stop the projection (and show Iris sick), never be absorbed into a number.
import { describe, expect, it } from "vitest";
import { type AgentEvent, ProjectionError, projectStatus } from "./agent-status.ts";

let id = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): AgentEvent => ({
  id: BigInt(++id),
  occurredAt: new Date(0),
  agent: "iris",
  type,
  payload,
});
const fetched = (count: number) => ev("mail.fetched", { count, truncated: false, durationMs: 1 });
const rules = (over: Record<string, unknown> = {}) =>
  ev("mail.sorted_by_rules", {
    clients_prospects: 1,
    administratif: 1,
    bruit: 1,
    a_trier: 0,
    remaining: 1,
    ...over,
  });

describe("mail counters — a full pass", () => {
  it("rules, then the model, add up to what was fetched", () => {
    const status = projectStatus("iris", [
      fetched(4),
      rules(),
      ev("mail.model_sorted", { category: "a_trier" }),
    ]);
    expect(status.mail).toEqual({
      clients_prospects: 1,
      administratif: 1,
      bruit: 1,
      a_trier: 1,
      pending: 0,
    });
  });

  it("a new pass adds its new mails to what is remembered", () => {
    const status = projectStatus("iris", [fetched(4), rules(), fetched(2)]);
    expect(status.mail).toEqual({
      clients_prospects: 1,
      administratif: 1,
      bruit: 1,
      a_trier: 0,
      pending: 3,
    });
  });

  it("totals from the store set the counters exactly (after retention, say)", () => {
    const status = projectStatus("iris", [
      fetched(4),
      rules(),
      ev("mail.totals", {
        clients_prospects: 0,
        administratif: 1,
        bruit: 1,
        a_trier: 0,
        pending: 0,
      }),
    ]);
    expect(status.mail).toEqual({
      clients_prospects: 0,
      administratif: 1,
      bruit: 1,
      a_trier: 0,
      pending: 0,
    });
  });
});

describe("mail counters — refused", () => {
  it.each([
    ["a negative count", [fetched(-1)]],
    ["a fractional count", [fetched(1.5)]],
    ["a string count", [ev("mail.fetched", { count: "4" })]],
    ["rules before any fetch", [rules()]],
    ["rules sorting more than pending", [fetched(2), rules()]],
    ["totals with a missing count", [ev("mail.totals", { bruit: 1 })]],
    [
      "negative totals",
      [
        ev("mail.totals", {
          clients_prospects: -1,
          administratif: 0,
          bruit: 0,
          a_trier: 0,
          pending: 0,
        }),
      ],
    ],
    ["a missing category count", [fetched(4), rules({ bruit: undefined })]],
    ["a model sort before any fetch", [ev("mail.model_sorted", { category: "bruit" })]],
    [
      "more model sorts than pending",
      [
        fetched(4),
        rules(),
        ev("mail.model_sorted", { category: "bruit" }),
        ev("mail.model_sorted", { category: "bruit" }),
      ],
    ],
    [
      "an unknown category",
      [
        fetched(1),
        rules({ clients_prospects: 0, administratif: 0, bruit: 0 }),
        ev("mail.model_sorted", { category: "spam" }),
      ],
    ],
  ])("refuses %s", (_label, events) => {
    expect(() => projectStatus("iris", events)).toThrow(ProjectionError);
  });
});
