// The maintenance plan's driver (J7d): one step at a time, never two in a
// pass; a launched step waits for its outcome and its proof; a proved one
// lets the next go at once; the problem gone, the step is skipped; every
// other ending stops the plan, cancels the rest, says it and turns the card
// back. A stale, future or unreadable verdict waits; six hours after my
// confirmation, the rest expires. A reboot waits while a cluster lacks its
// quorum or a machine of the plan does not answer. The switch off stops it.
import type { PlanStep, StoredPlan, StoredServerAction, Verified } from "@cenacle/journal";
import type { Observation } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { drivePlan, type PlanDeps } from "./plan.ts";
import { runOperator } from "./run.ts";
import { MIN, NOW, world as operatorWorld, type Row } from "./test-world.ts";

type Step = { -readonly [K in keyof PlanStep]: PlanStep[K] };
type Action = { -readonly [K in keyof StoredServerAction]: StoredServerAction[K] };
const HOUR = 60 * MIN;
const obs = (type: string, target: string): Observation => ({
  type,
  target,
  occurrence: "-",
  severity: "moyen",
  title: "x",
});

function world(
  steps: Array<[string, Step["action"], boolean]>,
  over: { confirmedAgo?: number; state?: StoredPlan["state"] } = {},
) {
  const plan = {
    id: 7,
    state: over.state ?? ("confirmee" as StoredPlan["state"]),
    createdAt: NOW,
    confirmedAt: new Date(NOW.getTime() - (over.confirmedAgo ?? MIN)),
    messageId: null,
    steps: steps.map(
      ([host, action, conditional], i): Step => ({
        id: 100 + i,
        position: i,
        host,
        action,
        conditional,
        state: "attente",
        actionId: null,
        reason: null,
      }),
    ),
  };
  const actions = new Map<number, Action>();
  const sent: string[] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let verdictAt = NOW.getTime() - 5 * MIN;
  let etats: Record<string, string> = { "vps-b": "SOUFFRANT", "noeud-a": "SOUFFRANT" };
  let seen: Observation[] = [];
  const snapshot = (): StoredPlan => ({ ...plan, steps: plan.steps.map((s) => ({ ...s })) });
  const step = (id: number) => plan.steps.find((s) => s.id === id);
  const deps: PlanDeps = {
    active: true,
    plans: {
      running: async () => (["confirmee", "en_cours"].includes(plan.state) ? snapshot() : null),
      get: async () => snapshot(),
      start: async () => {
        plan.state = "en_cours";
        return true;
      },
      launch: async (id, actionId) => {
        const s = step(id);
        if (s === undefined || s.state !== "attente") return false;
        s.state = "lancee";
        s.actionId = actionId;
        return true;
      },
      settle: async (id, state, reason) => {
        const s = step(id);
        if (s === undefined || !["attente", "lancee"].includes(s.state)) return false;
        s.state = state;
        s.reason = reason;
        return true;
      },
      finish: async (_, state) => {
        plan.state = state;
        for (const s of plan.steps) if (s.state === "attente") s.state = "annulee";
        return true;
      },
      purge: async () => 0,
    },
    actions: {
      enqueueForPlan: async (planId, host, action) => {
        const id = 500 + actions.size;
        actions.set(id, {
          id,
          findingId: null,
          planId,
          host,
          action,
          state: "confirmee",
          requestedAt: NOW,
          finishedAt: null,
          exitCode: null,
          refusal: null,
          verified: null,
          beforeCount: null,
          afterCount: null,
        });
        return id;
      },
      get: async (id) => actions.get(id) ?? null,
    },
    verdict: () =>
      [
        "bulletin=1",
        `instant=${Math.floor(verdictAt / 1000)}`,
        ...Object.entries(etats).map(([h, e]) => `${h}.etat=${e}`),
        "fin=1",
      ].join("\n"),
    parseVerdict: () => seen,
    send: async (text) => {
      sent.push(text);
    },
    journal: {
      append: async (e) => {
        events.push({ type: e.type, payload: e.payload ?? {} });
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
  };
  /** The action the launched step made, ended as the operator would end it. */
  const answer = (patch: Partial<Action>) => {
    const launched = plan.steps.find((s) => s.state === "lancee");
    const a = actions.get(launched?.actionId ?? -1);
    if (a === undefined) throw new Error("nothing launched");
    Object.assign(a, patch);
  };
  return {
    deps,
    plan,
    actions,
    sent,
    events,
    answer,
    seen: (s: Observation[]) => {
      seen = s;
    },
    verdictAt: (ms: number) => {
      verdictAt = ms;
    },
    etats: (e: Record<string, string>) => {
      etats = e;
    },
  };
}

const proved = (verified: Verified): Partial<Action> => ({ state: "faite", exitCode: 0, verified });

describe("a plan's first pass", () => {
  it("started, the card at work, said; its first step launched — and only one", async () => {
    const w = world([
      ["vps-b", "maj_securite", false],
      ["vps-b", "services", true],
    ]);
    w.seen([obs("serveur_maj_securite", "vps-b"), obs("serveur_services", "vps-b")]);
    await drivePlan(w.deps);
    expect(w.plan.state).toBe("en_cours");
    expect(w.events[0]).toEqual({ type: "state.changed", payload: { to: "acting" } });
    expect(w.sent[0]).toMatch(/^▶ Plan n°7 lancé : vps-b\./);
    expect(w.plan.steps.map((s) => s.state)).toEqual(["lancee", "attente"]);
    expect(w.actions.size).toBe(1);
    expect([...w.actions.values()][0]).toMatchObject({
      planId: 7,
      findingId: null,
      action: "maj_securite",
    });
  });

  it("no plan: nothing at all", async () => {
    const w = world([["vps-b", "services", false]], { state: "terminee" });
    await drivePlan(w.deps);
    expect(w.sent).toEqual([]);
    expect(w.events).toEqual([]);
  });
});

describe("waiting, then going on", () => {
  const twoMachines = () => {
    const w = world([
      ["vps-b", "services", false],
      ["noeud-a", "maj_securite", false],
      ["noeud-a", "redemarrer", true],
    ]);
    w.seen([obs("serveur_services", "vps-b"), obs("serveur_maj_securite", "noeud-a")]);
    return w;
  };

  it("waits while the action runs, and while its proof has not come", async () => {
    const w = twoMachines();
    await drivePlan(w.deps);
    await drivePlan(w.deps);
    w.answer({ state: "en_cours" });
    await drivePlan(w.deps);
    w.answer({ state: "faite", exitCode: 0 });
    await drivePlan(w.deps);
    expect(w.actions.size).toBe(1);
    expect(w.plan.steps[0]?.state).toBe("lancee");
  });

  it("proved: the machine's line, the next step at once; an 'if needed' with no motif skipped", async () => {
    const w = twoMachines();
    await drivePlan(w.deps);
    w.answer(proved("epargnes"));
    w.seen([obs("serveur_maj_securite", "noeud-a")]);
    await drivePlan(w.deps);
    expect(w.sent.at(-1)).toBe("✅ vps-b : 🔁 fait");
    expect(w.plan.steps.map((s) => s.state)).toEqual(["faite", "lancee", "attente"]);
    w.answer(proved("disparu"));
    w.seen([]); // no reboot asked after the update
    await drivePlan(w.deps);
    expect(w.plan.steps.map((s) => s.state)).toEqual(["faite", "faite", "sautee"]);
    expect(w.sent.slice(-2)).toEqual([
      "✅ noeud-a : ⬆ fait · 🔄 sauté",
      "✅ Plan n°7 terminé : 2 étape(s) faite(s), 1 sautée(s) (plus rien à faire au moment voulu).",
    ]);
    expect(w.plan.state).toBe("terminee");
    expect(w.events.at(-2)).toEqual({ type: "state.changed", payload: { to: "idle" } });
  });

  it("nothing to do on the server, or the problem found gone: skipped, not a hitch", async () => {
    for (const patch of [
      { state: "rien_a_faire", exitCode: 125 },
      { state: "refusee", refusal: "plus_de_motif" },
    ] as Partial<Action>[]) {
      const w = twoMachines();
      await drivePlan(w.deps);
      w.answer(patch);
      await drivePlan(w.deps);
      expect(w.plan.steps[0]?.state).toBe("sautee");
      expect(w.plan.state).toBe("en_cours");
    }
  });
});

describe("the first hitch stops everything", () => {
  it.each([
    ["still there", proved("toujours_la"), "preuve_toujours_la"],
    ["fewer but more than the spared", proved("reduit"), "preuve_reduit"],
    ["not back", proved("pas_revenue"), "preuve_pas_revenue"],
    ["a server guard", { state: "refusee_serveur", exitCode: 11 }, "refus_serveur"],
    ["a failure", { state: "echouee", exitCode: 12 }, "echec"],
    ["cut off", { state: "echouee", exitCode: -1 }, "etat_inconnu"],
    ["unreachable", { state: "echouee", exitCode: 255 }, "injoignable"],
    [
      "the operator's refusal",
      { state: "refusee", refusal: "redemarrage_recent" },
      "refus_redemarrage_recent",
    ],
  ] as Array<[string, Partial<Action>, string]>)(
    "%s: stopped, the rest cancelled, said, the card at rest",
    async (_, patch, reason) => {
      const w = world([
        ["vps-b", "services", false],
        ["noeud-a", "maj_securite", false],
      ]);
      w.seen([obs("serveur_services", "vps-b"), obs("serveur_maj_securite", "noeud-a")]);
      await drivePlan(w.deps);
      w.answer(patch);
      await drivePlan(w.deps);
      expect(w.plan.state).toBe("arretee");
      expect(w.plan.steps.map((s) => [s.state, s.reason])).toEqual([
        ["arretee", reason],
        ["annulee", null],
      ]);
      expect(w.sent.at(-1)).toMatch(
        /^🛑 vps-b : 🔁 arrêté\n🛑 Plan n°7 arrêté sur vps-b \(🔁\) : .*1 étape\(s\) non lancée\(s\), annulée\(s\)/,
      );
      expect(w.events.at(-2)).toEqual({ type: "state.changed", payload: { to: "idle" } });
      expect(w.actions.size).toBe(1);
    },
  );

  it("the launched action vanished: stopped", async () => {
    const w = world([["vps-b", "services", false]]);
    w.seen([obs("serveur_services", "vps-b")]);
    await drivePlan(w.deps);
    w.actions.clear();
    await drivePlan(w.deps);
    expect(w.plan.steps[0]).toMatchObject({ state: "arretee", reason: "action_disparue" });
  });
});

describe("what makes it wait or end", () => {
  it.each([
    ["older than 35 minutes", NOW.getTime() - 36 * MIN],
    ["from the future", NOW.getTime() + 6 * MIN],
  ])("a verdict %s: nothing launched, nothing stopped", async (_, at) => {
    const w = world([["vps-b", "services", false]]);
    w.seen([obs("serveur_services", "vps-b")]);
    w.verdictAt(at);
    await drivePlan(w.deps);
    expect(w.actions.size).toBe(0);
    expect(w.plan.state).toBe("en_cours");
  });

  it("an unreadable verdict: waits", async () => {
    const w = world([["vps-b", "services", false]]);
    await drivePlan({
      ...w.deps,
      parseVerdict: () => {
        throw new Error("tronqué");
      },
    });
    expect(w.actions.size).toBe(0);
    expect(w.plan.state).toBe("en_cours");
  });

  it("six hours after my confirmation: what has not started expires, said", async () => {
    const w = world([["vps-b", "services", false]], { confirmedAgo: 6 * HOUR + MIN });
    w.seen([obs("serveur_services", "vps-b")]);
    await drivePlan(w.deps);
    expect(w.plan.state).toBe("expiree");
    expect(w.actions.size).toBe(0);
    expect(w.sent.at(-1)).toMatch(/^⌛ Plan n°7 expiré, 6 heures après ta confirmation : 1 étape/);
  });

  it("the switch off: stopped at once, said", async () => {
    const w = world([["vps-b", "services", false]]);
    await drivePlan({ ...w.deps, active: false });
    expect(w.plan.state).toBe("arretee");
    expect(w.actions.size).toBe(0);
    expect(w.sent.at(-1)).toMatch(/\[maintenance\] actif/);
  });
});

describe("a reboot", () => {
  const reboot = () => {
    const w = world([
      ["vps-b", "services", false],
      ["noeud-a", "redemarrer", false],
    ]);
    w.plan.steps[0] = { ...(w.plan.steps[0] as Step), state: "faite" };
    return w;
  };

  it.each([
    [
      "a cluster without quorum",
      [obs("serveur_quorum", "noeud-a")],
      { "vps-b": "SOUFFRANT", "noeud-a": "SOUFFRANT" },
    ],
    ["a machine of the plan unreachable", [], { "vps-b": "MALADE", "noeud-a": "SOUFFRANT" }],
    ["a machine of the plan absent from the verdict", [], { "noeud-a": "SOUFFRANT" }],
  ] as Array<[string, Observation[], Record<string, string>]>)(
    "waits with %s",
    async (_, extra, etats) => {
      const w = reboot();
      w.seen([obs("serveur_redemarrage", "noeud-a"), ...extra]);
      w.etats(etats);
      await drivePlan(w.deps);
      expect(w.actions.size).toBe(0);
      expect(w.plan.state).toBe("en_cours");
    },
  );

  it("goes when a machine of the plan is MALADE only for a full disk: it answered", async () => {
    const w = reboot();
    w.seen([obs("serveur_redemarrage", "noeud-a"), obs("serveur_disque", "vps-b")]);
    w.etats({ "vps-b": "MALADE", "noeud-a": "SOUFFRANT" });
    await drivePlan(w.deps);
    expect([...w.actions.values()][0]?.action).toBe("redemarrer");
  });

  it("goes when every machine answers and no quorum is missing", async () => {
    const w = reboot();
    w.seen([obs("serveur_redemarrage", "noeud-a")]);
    await drivePlan(w.deps);
    expect([...w.actions.values()][0]?.action).toBe("redemarrer");
  });
});

describe("the operator's own messages", () => {
  it("a plan's step is told by the plan, never one message per action", async () => {
    const w = operatorWorld();
    (w.rows[0] as Row).planId = 7;
    (w.rows[0] as Row).findingId = null;
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "faite", told: true });
    expect(w.sent).toEqual([]);
  });
});
