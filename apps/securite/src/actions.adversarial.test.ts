// The fixes I asked for (J6c), run by the round: checked again before acting;
// a PR opened gives its link; a failure says at which step, and nothing is
// merged; the PRs opened are followed on the network rounds only — a failed
// CI or a PR closed without merging is said once; the journal gets outcomes.
import type { ActionState, NewEvent, StoredFinding } from "@cenacle/journal";
import type { PrStatus } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { runActions } from "./actions.ts";
import type { FixResult } from "./fix.ts";

const finding = (id: number, over: Partial<StoredFinding> = {}): StoredFinding =>
  ({
    id,
    type: "npm_advisory",
    target: "left-pad",
    occurrence: "1101",
    params: { fixName: "left-pad", fixVersion: "1.3.1" },
    actionState: "demandee",
    actionPrUrl: null,
    ...over,
  }) as StoredFinding;

function world(
  pending: StoredFinding[],
  prs: StoredFinding[],
  result: FixResult,
  status: PrStatus = "pending",
) {
  const states: [number, ActionState, string | undefined][] = [];
  const sent: string[] = [];
  const events: NewEvent[] = [];
  const prepared: string[] = [];
  const deps = {
    store: {
      pendingFixes: async () => pending,
      openPullRequests: async () => prs,
      setAction: async (id: number, state: ActionState, url?: string) => {
        states.push([id, state, url]);
      },
    },
    prepare: async (req: { name: string; version: string }) => {
      prepared.push(`${req.name}@${req.version}`);
      return result;
    },
    status: async () => status,
    send: async (t: string) => {
      sent.push(t);
    },
    journal: {
      append: async (e: NewEvent) => {
        events.push(e);
        return {
          id: 1n,
          occurredAt: new Date(),
          agent: e.agent,
          type: e.type,
          payload: e.payload ?? {},
        };
      },
    },
  };
  return { deps, states, sent, events, prepared };
}
const OK: FixResult = {
  ok: true,
  url: "https://github.com/o/r/pull/9",
  branch: "securite/correctif-left-pad-1.3.1",
};

describe("a fix I asked for", () => {
  it("prepared, its PR link sent, the merge left to me", async () => {
    const w = world([finding(3)], [], OK);
    expect(await runActions(w.deps, false)).toBe(1);
    expect(w.prepared).toEqual(["left-pad@1.3.1"]);
    expect(w.states).toEqual([[3, "pr_ouverte", "https://github.com/o/r/pull/9"]]);
    expect(w.sent[0]).toMatch(/PR ouverte pour le constat n°3.*pull\/9[\s\S]*jamais à l'agent/);
    expect(w.events.map((e) => e.payload)).toEqual([{ outcome: "pr_opened" }]);
  });

  it("no longer fixable when the round comes: nothing prepared, said", async () => {
    const w = world([finding(3, { params: { fixName: "x; rm", fixVersion: "1.0.0" } })], [], OK);
    await runActions(w.deps, false);
    expect(w.prepared).toEqual([]);
    expect(w.states).toEqual([[3, "echouee", undefined]]);
  });

  it("a failure says at which step; nothing merged; I may ask again", async () => {
    const w = world([finding(3)], [], { ok: false, step: "diff" });
    await runActions(w.deps, false);
    expect(w.states).toEqual([[3, "echouee", undefined]]);
    expect(w.sent[0]).toMatch(
      /vérifier que seuls les fichiers de paquets changent[\s\S]*Rappuie sur 🔧/,
    );
    expect(w.events.map((e) => e.payload)).toEqual([{ outcome: "failed_diff" }]);
  });
});

describe("the PRs opened, followed", () => {
  const pr = finding(5, {
    actionState: "pr_ouverte",
    actionPrUrl: "https://github.com/o/r/pull/9",
  });

  it("a failed CI or a PR closed without merging: said once, its state changed", async () => {
    for (const [status, state] of [
      ["ci_failed", "ci_echouee"],
      ["closed", "abandonnee"],
    ] as const) {
      const w = world([], [pr], OK, status);
      await runActions(w.deps, true);
      expect(w.states).toEqual([[5, state, undefined]]);
      expect(w.sent).toHaveLength(1);
    }
  });

  it("merged, passing or pending: nothing to say (the checks will resolve it)", async () => {
    for (const status of ["merged", "ci_passed", "pending", "unknown"] as const) {
      const w = world([], [pr], OK, status);
      await runActions(w.deps, true);
      expect(w.states).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it("followed on the network rounds only", async () => {
    const w = world([], [pr], OK, "ci_failed");
    await runActions(w.deps, false);
    expect(w.states).toEqual([]);
  });
});
