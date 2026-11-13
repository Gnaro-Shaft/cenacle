// Before acting, the operator verifies that I confirmed (ADR-0036): an action
// written "confirmed" without the bot, moved to another machine, made young
// again, or signed by another key is refused by name before any call; a
// plan's step runs only as the step that signed plan has in hand; a plan no
// bot signed, or given one more step, stops before launching anything.
// Without the bot's public key nothing is verified, so nothing runs.
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  confirmPrivateKeyFromEnv,
  generateConfirmationKeys,
  refuseForeignSecrets,
  signActionConfirmation,
  signPlanConfirmation,
} from "@cenacle/core";
import {
  actionConfirmationOf,
  planConfirmationOf,
  type StoredPlan,
  type StoredServerAction,
} from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { confirmKeyOrNull, notConfirmed, planSigned } from "./confirmation.ts";
import { drivePlan } from "./plan.ts";
import { runOperator } from "./run.ts";
import { obs, planWorld } from "./test-plan-world.ts";
import { MIN, NOW, type Row, world } from "./test-world.ts";

const keys = generateConfirmationKeys();
const priv = confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey });
const publicKey = confirmKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey });
const noPlans = { get: async () => null };

const signedAction = (a: StoredServerAction): StoredServerAction => {
  const fields = actionConfirmationOf(a);
  if (fields === null) throw new Error("not an action of my button");
  return { ...a, confirmSig: signActionConfirmation(priv, fields) };
};
const signedPlan = (p: StoredPlan): StoredPlan => {
  const fields = planConfirmationOf(p);
  if (fields === null) throw new Error("not a confirmed plan");
  return { ...p, confirmSig: signPlanConfirmation(priv, fields) };
};
/** My button's action, confirmed a minute ago, signed by the bot. */
const mine = (): StoredServerAction => signedAction({ ...(world().rows[0] as Row) });
const check = (a: StoredServerAction, plan: StoredPlan | null = null) =>
  notConfirmed({ publicKey, plans: { get: async () => plan } }, a);

describe("my button's action", () => {
  it("signed by the bot for this very row: mine", async () => {
    expect(await check(mine())).toBeNull();
  });

  it.each([
    [
      "written 'confirmed' with no signature",
      (a: StoredServerAction) => ({ ...a, confirmSig: null }),
    ],
    ["moved to another machine", (a: StoredServerAction) => ({ ...a, host: "noeud-a" })],
    ["turned into a reboot", (a: StoredServerAction) => ({ ...a, action: "redemarrer" as const })],
    ["hung under another finding", (a: StoredServerAction) => ({ ...a, findingId: 999 })],
    ["given another row's number", (a: StoredServerAction) => ({ ...a, id: a.id + 1 })],
    [
      "made young again, to slip under the 15 minutes",
      (a: StoredServerAction) => ({ ...a, confirmedAt: NOW }),
    ],
    ["with no instant of confirmation", (a: StoredServerAction) => ({ ...a, confirmedAt: null })],
    ["with a signature that is not one", (a: StoredServerAction) => ({ ...a, confirmSig: "ok" })],
  ])("%s: refused as not signed", async (_label, tamper) => {
    expect(await check(tamper(mine()))).toBe("confirmation_non_signee");
  });

  it("signed by another key — even the right fields: refused", async () => {
    const other = confirmPrivateKeyFromEnv({
      [CONFIRM_PRIVATE_KEY_VAR]: generateConfirmationKeys().privateKey,
    });
    const a = { ...(world().rows[0] as Row) };
    const fields = actionConfirmationOf(a);
    if (fields === null) throw new Error("fields");
    expect(await check({ ...a, confirmSig: signActionConfirmation(other, fields) })).toBe(
      "confirmation_non_signee",
    );
  });

  it("without the bot's public key: nothing is verified, so nothing is mine", async () => {
    expect(await notConfirmed({ publicKey: null, plans: noPlans }, mine())).toBe(
      "cle_de_confirmation_absente",
    );
  });
});

describe("a plan's step", () => {
  /** A signed plan under way, its first step launched as action 500. */
  const underWay = () => {
    const w = planWorld([
      ["vps-b", "services", false],
      ["noeud-a", "redemarrer", true],
    ]);
    const plan = signedPlan({
      ...w.plan,
      state: "en_cours",
      steps: w.plan.steps.map((s, i) =>
        i === 0 ? { ...s, state: "lancee" as const, actionId: 500 } : { ...s },
      ),
    });
    const step: StoredServerAction = {
      ...(world().rows[0] as Row),
      id: 500,
      findingId: null,
      planId: plan.id,
      host: "vps-b",
      action: "services",
      confirmSig: null,
    };
    return { plan, step };
  };

  it("the step its signed plan has in hand: mine, with no signature of its own", async () => {
    const { plan, step } = underWay();
    expect(await check(step, plan)).toBeNull();
  });

  it.each([
    ["a plan no bot signed", (p: StoredPlan) => ({ ...p, confirmSig: null })],
    [
      "a plan given one more step",
      (p: StoredPlan) => ({
        ...p,
        steps: [
          ...p.steps,
          { ...(p.steps[1] as StoredPlan["steps"][number]), id: 999, position: 2, host: "vps-b" },
        ],
      }),
    ],
    [
      "a plan whose removed step came back",
      (p: StoredPlan) => {
        // Signed without its second step, then read with it again.
        const without = signedPlan({
          ...p,
          steps: p.steps.map((s, i) => (i === 1 ? { ...s, state: "retiree" as const } : s)),
        });
        return {
          ...without,
          steps: without.steps.map((s, i) => (i === 1 ? { ...s, state: "attente" as const } : s)),
        };
      },
    ],
    ["a plan confirmed at another instant", (p: StoredPlan) => ({ ...p, confirmedAt: NOW })],
  ])("%s: refused as not signed", async (_label, tamper) => {
    const { plan, step } = underWay();
    expect(await check(step, tamper(plan))).toBe("confirmation_non_signee");
  });

  it("a plan that vanished: refused", async () => {
    expect(await check(underWay().step, null)).toBe("confirmation_non_signee");
  });

  it.each([
    ["another row claiming to be the step", (a: StoredServerAction) => ({ ...a, id: 501 })],
    ["the step's row, on another machine", (a: StoredServerAction) => ({ ...a, host: "noeud-a" })],
    [
      "the step's row, as another action",
      (a: StoredServerAction) => ({ ...a, action: "redemarrer" as const }),
    ],
  ])("%s: not the step in hand", async (_label, tamper) => {
    const { plan, step } = underWay();
    expect(await check(tamper(step), plan)).toBe("etape_hors_plan");
  });

  it.each([
    ["a step still waiting", "attente"],
    ["a step already done", "faite"],
    ["a step cancelled", "annulee"],
  ] as const)("%s: not the step in hand", async (_label, state) => {
    const { plan, step } = underWay();
    const moved = { ...plan, steps: plan.steps.map((s, i) => (i === 0 ? { ...s, state } : s)) };
    expect(await check(step, moved)).toBe("etape_hors_plan");
  });

  it("a plan that is no longer running: its step does not run either", async () => {
    const { plan, step } = underWay();
    expect(await check(step, { ...plan, state: "arretee" })).toBe("etape_hors_plan");
  });

  it("a row claiming both a finding and a plan: refused", async () => {
    const { plan, step } = underWay();
    expect(await check({ ...step, findingId: 40 }, plan)).toBe("confirmation_non_signee");
  });
});

describe("through the operator's pass", () => {
  const verifying = (w: ReturnType<typeof world>) => ({
    ...w.deps,
    notConfirmed: (a: StoredServerAction) => notConfirmed({ publicKey, plans: noPlans }, a),
  });

  it("signed: it acts", async () => {
    const w = world();
    Object.assign(w.rows[0] as Row, signedAction(w.rows[0] as Row));
    expect(await runOperator(verifying(w))).toMatchObject({ ran: 1, refused: 0 });
  });

  it("written 'confirmed' by another program: refused before any call, said, journaled by name", async () => {
    const w = world();
    expect(await runOperator(verifying(w))).toMatchObject({ ran: 0, refused: 1 });
    expect(w.calls).toEqual([]);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "confirmation_non_signee" });
    expect(w.sent[0]).toMatch(
      /^🛑 vps-b .* rien n'a été fait — cette confirmation n'est pas signée/,
    );
    expect(w.events).toEqual([
      { action: "services", outcome: "refusee", refusal: "confirmation_non_signee" },
    ]);
  });

  it("an old signed confirmation is still too old: the signature does not buy time", async () => {
    const w = world();
    (w.rows[0] as Row).confirmedAt = new Date(NOW.getTime() - 60 * MIN);
    Object.assign(w.rows[0] as Row, signedAction(w.rows[0] as Row));
    expect(await runOperator(verifying(w))).toMatchObject({ ran: 0, refused: 1 });
    expect(w.rows[0]).toMatchObject({ refusal: "confirmation_perimee" });
  });

  it("the switch off is said first; then the signature, before the age", async () => {
    const off = world({ active: false });
    await runOperator(verifying(off));
    expect(off.rows[0]).toMatchObject({ refusal: "interrupteur" });
    const both = world();
    (both.rows[0] as Row).confirmedAt = new Date(NOW.getTime() - 60 * MIN);
    await runOperator(verifying(both));
    expect(both.rows[0]).toMatchObject({ refusal: "confirmation_non_signee" });
  });

  it("without the public key: refused, and the message says which key and where", async () => {
    const w = world();
    await runOperator({
      ...w.deps,
      notConfirmed: (a) => notConfirmed({ publicKey: null, plans: noPlans }, a),
    });
    expect(w.calls).toEqual([]);
    expect(w.rows[0]).toMatchObject({ refusal: "cle_de_confirmation_absente" });
    expect(w.sent[0]).toMatch(/CENACLE_CONFIRM_PUBLIC_KEY.*npm run keys:confirm/);
  });
});

describe("the plan's driver", () => {
  it("a plan no bot signed: stopped before launching anything, the rest cancelled, said", async () => {
    const w = planWorld([
      ["vps-b", "services", false],
      ["noeud-a", "redemarrer", true],
    ]);
    w.seen([obs("serveur_services", "vps-b")]);
    await drivePlan({ ...w.deps, planSigned: (p) => planSigned(publicKey, p) });
    expect(w.plan.state).toBe("arretee");
    expect(w.actions.size).toBe(0);
    expect(w.plan.steps.map((s) => s.state)).toEqual(["annulee", "annulee"]);
    expect(w.sent.at(-1)).toMatch(
      /^🛑 Plan n°7 arrêté : sa confirmation n'est pas signée par le bot/,
    );
    expect(w.events.some((e) => e.payload.quoi === "lancee")).toBe(false);
  });

  it("signed, then given one more step between two passes: stopped at the next", async () => {
    const w = planWorld([["vps-b", "services", false]]);
    w.seen([obs("serveur_services", "vps-b")]);
    const sig = signedPlan({ ...w.plan }).confirmSig;
    Object.assign(w.plan, { confirmSig: sig });
    const deps = { ...w.deps, planSigned: (p: StoredPlan) => planSigned(publicKey, p) };
    await drivePlan(deps);
    expect(w.actions.size).toBe(1); // signed: the step went
    w.plan.steps.push({
      id: 150,
      position: 1,
      host: "noeud-a",
      action: "redemarrer",
      conditional: false,
      state: "attente",
      actionId: null,
      reason: null,
    });
    await drivePlan(deps);
    expect(w.plan.state).toBe("arretee");
    expect(w.actions.size).toBe(1);
    expect(w.plan.steps[1]?.state).toBe("annulee");
  });

  it("without the public key, no plan is signed", () => {
    const signed = signedPlan({ ...planWorld([["vps-b", "services", false]]).plan });
    expect(planSigned(publicKey, signed)).toBe(true);
    expect(planSigned(null, signed)).toBe(false);
    expect(planSigned(publicKey, { ...signed, confirmedAt: null })).toBe(false);
  });
});

describe("the keys", () => {
  it("a missing, empty or garbage public key reads as none — never as a key that accepts", () => {
    expect(confirmKeyOrNull({})).toBeNull();
    expect(confirmKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: "" })).toBeNull();
    expect(confirmKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: "not-a-key" })).toBeNull();
    expect(confirmKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: keys.privateKey })).toBeNull();
    expect(publicKey).not.toBeNull();
  });

  it("the operator refuses to start with the bot's private key; the bot may hold it", () => {
    const env = { [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey };
    expect(() => refuseForeignSecrets("L'opérateur", ["telegram"], env)).toThrow(
      /must not hold CENACLE_CONFIRM_PRIVATE_KEY/,
    );
    expect(() => refuseForeignSecrets("The Telegram bot", ["telegram", "bot"], env)).not.toThrow();
  });
});
