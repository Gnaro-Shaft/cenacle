// The fixes and their pull requests at each round (J6c, J6d): my 🔧 is
// prepared; a green CI sends ✅ Fusionner on the commit it tested; my ✅ is
// merged only through merge.ts, a refusal said; each outcome is journaled for
// the trust record; a delegation is proposed once, prepares by itself once
// granted (never a major change), and is suspended by one failure of a
// delegated pull request.
import type { ActionState, NewEvent, StoredFinding } from "@cenacle/journal";
import type { PrView } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { type DelegationInfo, runActions } from "./actions.ts";
import type { FixResult } from "./fix.ts";
import type { MergeOutcome } from "./merge.ts";

const SHA = "a".repeat(40);
const URL = "https://github.com/o/r/pull/9";
const finding = (id: number, over: Partial<StoredFinding> = {}): StoredFinding =>
  ({
    id,
    type: "npm_advisory",
    target: "left-pad",
    occurrence: "1101",
    status: "ouvert",
    params: { fixName: "left-pad", fixVersion: "1.3.1", fixMajor: "0" },
    actionState: null,
    actionPrUrl: null,
    actionHeadSha: null,
    actionDelegated: false,
    ...over,
  }) as StoredFinding;
const view = (over: Partial<PrView> = {}): PrView => ({
  status: "pending",
  headSha: SHA,
  base: "main",
  files: ["package-lock.json"],
  commits: 1,
  ...over,
});
const OK: FixResult = { ok: true, url: URL, branch: "securite/correctif-left-pad-1.3.1" };

function world(opts: {
  open?: StoredFinding[];
  pending?: StoredFinding[];
  prs?: StoredFinding[];
  requests?: StoredFinding[];
  result?: FixResult;
  view?: PrView;
  merge?: MergeOutcome;
  delegations?: DelegationInfo[];
}) {
  const states: [number, ActionState, string | undefined, string | undefined][] = [];
  const sent: string[] = [];
  const buttons: string[][] = [];
  const events: NewEvent[] = [];
  const delegated: number[] = [];
  const merged: string[] = [];
  const deps = {
    store: {
      open: async () => opts.open ?? [],
      pendingFixes: async () => opts.pending ?? [],
      openPullRequests: async () => opts.prs ?? [],
      prRequests: async () => opts.requests ?? [],
      setAction: async (id: number, s: ActionState, url?: string, sha?: string) => {
        states.push([id, s, url, sha]);
      },
      delegateFix: async (id: number) => {
        delegated.push(id);
        return true;
      },
    },
    prepare: async () => opts.result ?? OK,
    view: async () => opts.view ?? view(),
    merge: async (url: string, sha: string) => {
      merged.push(`${url}@${sha}`);
      return opts.merge ?? { ok: true as const, clean: true };
    },
    close: async () => true,
    tokens: async (ids: readonly number[]) => new Map(ids.map((i) => [i, "0123456789abcdef"])),
    send: async (t: string) => {
      sent.push(t);
    },
    sendButtons: async (t: string, rows: { data: string }[][]) => {
      sent.push(t);
      buttons.push(rows.flat().map((b) => b.data));
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
    delegations: opts.delegations ?? [],
    now: () => new Date("2026-10-11T10:00:00Z"),
  };
  return { deps, states, sent, buttons, events, delegated, merged };
}
const outcomes = (events: NewEvent[]) =>
  events.filter((e) => e.type === "securite.action").map((e) => e.payload?.outcome);

describe("a fix I asked for, then its pull request", () => {
  it("prepared: PR opened, its link sent, journaled for the record", async () => {
    const w = world({ pending: [finding(3, { actionState: "demandee" })] });
    expect(await runActions(w.deps)).toBe(1);
    expect(w.states[0]).toEqual([3, "pr_ouverte", URL, undefined]);
    expect(w.sent[0]).toMatch(/PR ouverte \(sur ta demande\)/);
    expect(w.events[0]?.payload).toEqual({
      outcome: "pr_opened",
      delegable: "preparer_pr_npm",
      delegated: false,
    });
  });

  it("CI green: the merge buttons, bound to the commit the CI tested", async () => {
    const w = world({
      prs: [finding(3, { actionState: "pr_ouverte", actionPrUrl: URL })],
      view: view({ status: "ci_passed" }),
    });
    await runActions(w.deps);
    expect(w.states).toEqual([[3, "ci_verte", undefined, SHA]]);
    expect(w.buttons[0]).toEqual(["p:3:m:0123456789abcdef", "p:3:c:0123456789abcdef"]);
    expect(w.sent[0]).toMatch(/aaaaaaa/);
  });

  it("a commit pushed after the buttons: back to being followed", async () => {
    const w = world({
      prs: [finding(3, { actionState: "ci_verte", actionPrUrl: URL, actionHeadSha: SHA })],
      view: view({ status: "ci_passed", headSha: "b".repeat(40) }),
    });
    await runActions(w.deps);
    expect(w.states).toEqual([[3, "pr_ouverte", undefined, undefined]]);
  });
});

describe("my ✅ and ❌", () => {
  const asked = (state: ActionState) =>
    finding(4, {
      status: "pris_en_charge",
      actionState: state,
      actionPrUrl: URL,
      actionHeadSha: SHA,
    });

  it("✅: merged on the commit I saw; a clean merge counts as such", async () => {
    const w = world({ requests: [asked("fusion_demandee")] });
    await runActions(w.deps);
    expect(w.merged).toEqual([`${URL}@${SHA}`]);
    expect(w.states).toEqual([[4, "fusionnee", undefined, undefined]]);
    expect(outcomes(w.events)).toEqual(["merged_clean"]);
  });

  it("✅ refused (the commit moved): nothing merged, said, followed again", async () => {
    const w = world({
      requests: [asked("fusion_demandee")],
      merge: { ok: false, reason: "moved" },
    });
    await runActions(w.deps);
    expect(w.states).toEqual([[4, "pr_ouverte", undefined, undefined]]);
    expect(w.sent[0]).toMatch(/Fusion refusée.*un autre commit/);
    expect(outcomes(w.events)).toEqual([]);
  });

  it("✅ without a tested commit: never merged", async () => {
    const w = world({
      requests: [finding(4, { actionState: "fusion_demandee", actionPrUrl: URL })],
    });
    await runActions(w.deps);
    expect(w.merged).toEqual([]);
  });

  it("❌: closed, and it counts as a refusal", async () => {
    const w = world({ requests: [asked("fermeture_demandee")] });
    await runActions(w.deps);
    expect(w.states).toEqual([[4, "fermee", undefined, undefined]]);
    expect(outcomes(w.events)).toEqual(["closed"]);
  });

  it("merged by me on GitHub with a change of mine: counted as edited", async () => {
    const w = world({ prs: [asked("pr_ouverte")], view: view({ status: "merged", commits: 2 }) });
    await runActions(w.deps);
    expect(outcomes(w.events)).toEqual(["merged_edited"]);
  });
});

describe("delegations", () => {
  const info = (
    state: DelegationInfo["state"],
    proposedAt: Date | null = null,
  ): DelegationInfo => ({
    action: "preparer_pr_npm",
    state,
    seuil: 5,
    mergedClean: 5,
    proposedAt,
  });

  it("proposable: the CTO proposes it once, with the line to add", async () => {
    const w = world({ delegations: [info("proposable")] });
    await runActions(w.deps);
    expect(w.sent[0]).toMatch(
      /te propose une délégation[\s\S]*accordee_le = 2026-10-11[\s\S]*La fusion restera à toi/,
    );
    const again = world({ delegations: [info("proposable", new Date())] });
    await runActions(again.deps);
    expect(again.sent).toEqual([]);
  });

  it("granted: an open fixable advisory is prepared by itself — never a major change", async () => {
    const w = world({
      delegations: [info("accordee")],
      open: [
        finding(1),
        finding(2, { params: { fixName: "x", fixVersion: "2.0.0", fixMajor: "1" } }),
        finding(3, { type: "firewall_off", params: {} }),
        finding(4, { actionState: "echouee" }),
      ],
    });
    await runActions(w.deps);
    expect(w.delegated).toEqual([1]);
  });

  it("not granted, or suspended: nothing prepared by itself", async () => {
    for (const state of ["apprentissage", "proposable", "suspendue"] as const) {
      const w = world({ delegations: [info(state, new Date())], open: [finding(1)] });
      await runActions(w.deps);
      expect(w.delegated).toEqual([]);
    }
  });

  it("one failure on a delegated pull request suspends the delegation at once", async () => {
    for (const [v, outcome] of [
      [view({ status: "ci_failed" }), "ci_failed"],
      [view({ status: "closed" }), "closed"],
      [view({ status: "merged", commits: 3 }), "merged_edited"],
    ] as const) {
      const w = world({
        prs: [finding(5, { actionState: "pr_ouverte", actionPrUrl: URL, actionDelegated: true })],
        view: v,
      });
      await runActions(w.deps);
      expect(outcomes(w.events)).toEqual([outcome]);
      expect(
        w.events.filter((e) => e.type === "securite.delegation").map((e) => e.payload),
      ).toEqual([{ delegable: "preparer_pr_npm", state: "suspendue" }]);
    }
  });

  it("the same failure on a pull request I asked for suspends nothing", async () => {
    const w = world({
      prs: [finding(5, { actionState: "pr_ouverte", actionPrUrl: URL })],
      view: view({ status: "ci_failed" }),
    });
    await runActions(w.deps);
    expect(w.events.filter((e) => e.type === "securite.delegation")).toEqual([]);
  });
});
