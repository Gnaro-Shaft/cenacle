// My confirmation, signed (ADR-0036), in the real database: the signature is
// made on the row locked for the confirmation, as it reads once confirmed,
// and written with it — both or neither; a signer that fails confirms
// nothing. And the database freezes what I was shown: a step is added only
// while its plan is proposed, never changes, never comes back once removed,
// and nothing is removed once I confirmed — whoever asks.
import { randomBytes } from "node:crypto";
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  confirmPrivateKeyFromEnv,
  confirmPublicKeyFromEnv,
  generateConfirmationKeys,
  signActionConfirmation,
  signPlanConfirmation,
  verifyActionConfirmation,
  verifyPlanConfirmation,
} from "@cenacle/core";
import { afterAll, describe, expect, it } from "vitest";
import { createPlanStore, type StoredPlan } from "./maintenance-plans.ts";
import { createSecuriteStore, type SeenFinding } from "./securite-store.ts";
import { createServeurActions, type StoredServerAction } from "./serveur-actions.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const actions = createServeurActions(sql);
const plans = createPlanStore(sql);
const findings = createSecuriteStore(sql);
const keys = generateConfirmationKeys();
const priv = confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey });
const pub = confirmPublicKeyFromEnv({ [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey });
const T0 = new Date("2026-11-13T10:00:00Z");
const S = 1000;
const run = randomBytes(4).toString("hex");
const made: number[] = [];

/** Ends whatever plan runs, so a confirmation finds the way free. */
const freeTheWay = () =>
  sql`update maintenance_plans set state = 'arretee', finished_at = now()
      where state in ('confirmee', 'en_cours')`;
afterAll(async () => {
  // Leave nothing to run for the other tests' operator.
  await freeTheWay();
  await sql`update serveur_actions set state = 'expiree', finished_at = now()
            where id = any(${made}::bigint[]) and state in ('demandee', 'confirmee')`;
  await sql.end();
});

let n = 0;
async function request() {
  n += 1;
  const seen: SeenFinding = {
    check: "legion_ronde",
    type: "serveur_services",
    target: `sig-${run}-${n}`,
    occurrence: "-",
    severity: "moyen",
    title: "3 service(s) sur une bibliothèque remplacée",
  };
  await findings.apply({ insert: [seen], promote: [], touch: [], resolve: [], drop: [] }, T0);
  const id = (await findings.active()).find((f) => f.target === seen.target)?.id ?? 0;
  const r = await actions.request(id, seen.target, "services", T0);
  if (r === null) throw new Error("no request");
  made.push(r.id);
  return r;
}
const fieldsOf = (a: StoredServerAction) => ({
  id: a.id,
  host: a.host,
  action: a.action,
  findingId: a.findingId ?? 0,
  confirmedAt: a.confirmedAt ?? new Date(Number.NaN),
});
const signAction = (a: StoredServerAction) => signActionConfirmation(priv, fieldsOf(a));

const STEPS = [
  { host: "vps-b", action: "maj_securite" as const, conditional: false },
  { host: "vps-b", action: "services" as const, conditional: true },
  { host: "noeud-a", action: "redemarrer" as const, conditional: true },
];
const signedSteps = (p: StoredPlan) =>
  p.steps
    .filter((s) => s.state !== "retiree")
    .map((s) => ({
      position: s.position,
      host: s.host,
      action: s.action,
      conditional: s.conditional,
    }));
const planFields = (p: StoredPlan) => ({
  id: p.id,
  steps: signedSteps(p),
  confirmedAt: p.confirmedAt ?? new Date(Number.NaN),
});
const signPlan = (p: StoredPlan) => signPlanConfirmation(priv, planFields(p));
async function asked() {
  await freeTheWay();
  const p = await plans.propose(STEPS, T0);
  const token = await plans.ask(p.id, p.token, T0);
  if (token === null) throw new Error("no confirmation token");
  return { ...p, confirm: token };
}

/**
 * Holds rows locked in a transaction of its own, as a move in flight would,
 * until released: what must wait for them can then be seen waiting.
 */
async function holding(lock: (tx: typeof sql) => Promise<unknown>) {
  let release = () => {};
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked = () => {};
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = sql.begin(async (tx) => {
    await lock(tx as unknown as typeof sql);
    locked();
    await until;
  });
  await isLocked;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}
const aMoment = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("an action's signature is written with my confirmation", () => {
  it("made on the row as it reads once confirmed; read back, it verifies", async () => {
    const r = await request();
    const at = new Date(T0.getTime() + 30 * S);
    let shown: StoredServerAction | null = null;
    const outcome = await actions.confirm(r.id, r.token, at, (a) => {
      shown = a;
      return signAction(a);
    });
    expect(outcome).toBe("done");
    expect(shown).toMatchObject({ id: r.id, state: "confirmee", confirmedAt: at });
    const stored = await actions.get(r.id);
    if (stored === null) throw new Error("the action vanished");
    expect(stored.confirmSig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyActionConfirmation(pub, fieldsOf(stored), stored.confirmSig)).toBe(true);
    // The signature binds the machine: read on another, it is nothing.
    expect(
      verifyActionConfirmation(pub, { ...fieldsOf(stored), host: "noeud-a" }, stored.confirmSig),
    ).toBe(false);
  });

  it("a signer that fails confirms nothing — and the token still works after", async () => {
    const r = await request();
    await expect(
      actions.confirm(r.id, r.token, T0, () => {
        throw new Error("no key");
      }),
    ).rejects.toThrow(/no key/);
    expect(await actions.get(r.id)).toMatchObject({ state: "demandee", confirmSig: null });
    expect(await actions.confirm(r.id, r.token, T0, signAction)).toBe("done");
  });

  it("a signature that is not one is refused by the database: nothing confirmed", async () => {
    const r = await request();
    await expect(actions.confirm(r.id, r.token, T0, () => "signed, trust me")).rejects.toThrow(
      /confirm_sig_form/,
    );
    expect(await actions.get(r.id)).toMatchObject({ state: "demandee", confirmSig: null });
  });

  it("a wrong token, a late tap: the signer is never even asked", async () => {
    const r = await request();
    let calls = 0;
    const counting = (a: StoredServerAction) => {
      calls += 1;
      return signAction(a);
    };
    expect(await actions.confirm(r.id, "f".repeat(16), T0, counting)).toBe("stale");
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 121 * S), counting)).toBe(
      "expired",
    );
    expect(calls).toBe(0);
  });

  it("two taps at once: one signature, one 'already'", async () => {
    const r = await request();
    let calls = 0;
    const counting = (a: StoredServerAction) => {
      calls += 1;
      return signAction(a);
    };
    const outcomes = await Promise.all([
      actions.confirm(r.id, r.token, T0, counting),
      actions.confirm(r.id, r.token, T0, counting),
    ]);
    expect([...outcomes].sort()).toEqual(["already", "done"]);
    expect(calls).toBe(1);
  });

  it("the row is held before it is signed: while another move holds it, the signer is not asked", async () => {
    const r = await request();
    let calls = 0;
    const hold = await holding(
      (tx) => tx`select id from serveur_actions where id = ${r.id} for update`,
    );
    const confirming = actions.confirm(r.id, r.token, T0, (a) => {
      calls += 1;
      return signAction(a);
    });
    await aMoment();
    const asked = calls;
    // Released whatever was seen: a held row would hang every test after this one.
    await hold.release();
    expect(await confirming).toBe("done");
    // Signing first and locking after would sign a row another move may still change.
    expect(asked).toBe(0);
    expect(calls).toBe(1);
  });

  it("without a signer, as before the bot signs: confirmed, and visibly unsigned", async () => {
    const r = await request();
    expect(await actions.confirm(r.id, r.token, T0)).toBe("done");
    expect(await actions.get(r.id)).toMatchObject({ state: "confirmee", confirmSig: null });
  });
});

describe("a plan's signature covers its steps", () => {
  it("made on the plan and the steps I kept; read back, it verifies", async () => {
    const p = await asked();
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    const at = new Date(T0.getTime() + 60 * S);
    let shown: StoredPlan | null = null;
    expect(
      await plans.confirm(p.id, p.confirm, at, (plan) => {
        shown = plan;
        return signPlan(plan);
      }),
    ).toBe("done");
    expect(shown).toMatchObject({ id: p.id, state: "confirmee", confirmedAt: at });
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(signedSteps(stored).map((s) => s.host)).toEqual(["vps-b", "vps-b"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
    // The removed step, counted back in, breaks it.
    const all = stored.steps.map((s) => ({
      position: s.position,
      host: s.host,
      action: s.action,
      conditional: s.conditional,
    }));
    expect(
      verifyPlanConfirmation(pub, { ...planFields(stored), steps: all }, stored.confirmSig),
    ).toBe(false);
  });

  it("a signer that fails confirms nothing — and the token still works after", async () => {
    const p = await asked();
    await expect(
      plans.confirm(p.id, p.confirm, T0, () => {
        throw new Error("no key");
      }),
    ).rejects.toThrow(/no key/);
    expect(await plans.get(p.id)).toMatchObject({ state: "a_confirmer", confirmSig: null });
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
  });

  it("the steps are held before the plan is signed: a 'Retirer' in flight is waited for, then counted", async () => {
    const p = await asked();
    let shown: StoredPlan | null = null;
    // A removal in flight: the step is changed, not yet committed.
    const hold = await holding(
      (tx) => tx`update maintenance_etapes set state = 'retiree'
                 where plan_id = ${p.id} and host = 'noeud-a'`,
    );
    const confirming = plans.confirm(p.id, p.confirm, T0, (plan) => {
      shown = plan;
      return signPlan(plan);
    });
    await aMoment();
    const early = shown;
    await hold.release();
    expect(await confirming).toBe("done");
    expect(early).toBeNull();
    // Signed on what the removal left, not on what was there before it.
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(signedSteps(stored).map((x) => x.host)).toEqual(["vps-b", "vps-b"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
  });

  it("beside a running plan: 'busy', and no signature left behind", async () => {
    const running = await asked();
    expect(await plans.confirm(running.id, running.confirm, T0, signPlan)).toBe("done");
    const second = await plans.propose(STEPS, T0);
    const token = await plans.ask(second.id, second.token, T0);
    expect(await plans.confirm(second.id, token ?? "", T0, signPlan)).toBe("busy");
    expect(await plans.get(second.id)).toMatchObject({ state: "a_confirmer", confirmSig: null });
  });

  it("a signed plan still runs: start, launch, settle, end", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    expect(await plans.start(p.id)).toBe(true);
    const first = (await plans.get(p.id))?.steps[0];
    if (first === undefined) throw new Error("steps");
    const actionId = await plans.launchStep(first.id, T0);
    if (actionId === null) throw new Error("the step did not launch");
    made.push(actionId);
    expect(await plans.settle(first.id, "faite", null)).toBe(true);
    expect(await plans.finish(p.id, "terminee", null, T0)).toBe(true);
    const ended = await plans.get(p.id);
    expect(ended?.steps.map((s) => s.state)).toEqual(["faite", "annulee", "annulee"]);
    // Its states moved; what I signed did not.
    if (ended === null) throw new Error("the plan vanished");
    expect(verifyPlanConfirmation(pub, planFields(ended), ended.confirmSig)).toBe(true);
  });
});

describe("the steps are frozen by the database", () => {
  const addStep = (planId: number, position: number, state = "attente") =>
    sql`insert into maintenance_etapes (plan_id, position, host, action, conditional, state)
        values (${planId}, ${position}, 'noeud-z', 'redemarrer', false, ${state})`;

  it("a step is added waiting, and only while its plan is proposed — never once I am asked", async () => {
    await freeTheWay();
    const p = await plans.propose(STEPS, T0);
    await expect(addStep(p.id, 50, "lancee")).rejects.toThrow(/added waiting/);
    const token = await plans.ask(p.id, p.token, T0);
    // Asked: the list I read is the list I sign.
    await expect(addStep(p.id, 51)).rejects.toThrow(/only while its plan is proposed/);
    expect(await plans.confirm(p.id, token ?? "", T0, signPlan)).toBe("done");
    await expect(addStep(p.id, 52)).rejects.toThrow(/only while its plan is proposed/);
    await plans.start(p.id);
    await expect(addStep(p.id, 53)).rejects.toThrow(/only while its plan is proposed/);
    await expect(addStep(2 ** 40, 0)).rejects.toThrow();
    expect((await plans.get(p.id))?.steps).toHaveLength(3);
  });

  it.each([
    ["its machine", "host = 'noeud-z'"],
    ["its action", "action = 'redemarrer'"],
    ["its rank", "position = 77"],
    ["its condition", "conditional = not conditional"],
  ])("a step never changes %s, proposed or confirmed", async (_label, change) => {
    const p = await asked();
    const [step] = (await plans.get(p.id))?.steps ?? [];
    if (step === undefined) throw new Error("steps");
    const tamper = () =>
      sql.unsafe(`update maintenance_etapes set ${change} where id = ${step.id}`);
    await expect(tamper()).rejects.toThrow(/never change/);
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(tamper()).rejects.toThrow(/never change/);
    expect((await plans.get(p.id))?.steps[0]).toMatchObject({
      host: "vps-b",
      action: "maj_securite",
      position: 0,
      conditional: false,
    });
  });

  it("a step never moves to another plan", async () => {
    const a = await asked();
    const other = await plans.propose(STEPS, T0); // replaces `a`, still unconfirmed
    const [step] = (await plans.get(a.id))?.steps ?? [];
    if (step === undefined) throw new Error("steps");
    await expect(
      sql`update maintenance_etapes set plan_id = ${other.id}, position = 60 where id = ${step.id}`,
    ).rejects.toThrow(/never change/);
  });

  it("a removed step never comes back — not even before I confirm", async () => {
    const p = await asked();
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    const back = () =>
      sql`update maintenance_etapes set state = 'attente'
          where plan_id = ${p.id} and state = 'retiree'`;
    await expect(back()).rejects.toThrow(/never comes back/);
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(back()).rejects.toThrow(/never comes back/);
  });

  it("nothing is removed once I confirmed: not by the store, not by hand", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(false);
    await expect(
      sql`update maintenance_etapes set state = 'retiree' where plan_id = ${p.id}`,
    ).rejects.toThrow(/once confirmed/);
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(stored.steps.map((s) => s.state)).toEqual(["attente", "attente", "attente"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
  });

  it("a temporary table named like the plans does not thaw them", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("create temp table maintenance_plans (id bigint, state text)");
        await tx.unsafe(`insert into maintenance_plans values (${p.id}, 'proposee')`);
        await tx.unsafe(
          `insert into public.maintenance_etapes (plan_id, position, host, action, conditional, state)
           values (${p.id}, 54, 'noeud-z', 'redemarrer', false, 'attente')`,
        );
      }),
    ).rejects.toThrow(/only while its plan is proposed/);
    expect((await plans.get(p.id))?.steps).toHaveLength(3);
  });
});
