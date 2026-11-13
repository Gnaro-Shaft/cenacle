// What the signed-confirmation tests share (ADR-0036), in the real database:
// the stores, a key pair drawn for the run, a request and a plan ready to be
// confirmed, the signers the bot would be, and a way to hold rows as a move in
// flight would. Called once per test file: each has its own connection.
import { randomBytes } from "node:crypto";
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  confirmPrivateKeyFromEnv,
  confirmPublicKeyFromEnv,
  generateConfirmationKeys,
  signActionConfirmation,
  signPlanConfirmation,
} from "@cenacle/core";
import { afterAll } from "vitest";
import { createPlanStore, type StoredPlan } from "./maintenance-plans.ts";
import { createSecuriteStore, type SeenFinding } from "./securite-store.ts";
import { createServeurActions, type StoredServerAction } from "./serveur-actions.ts";
import { appConnection } from "./test-db.ts";

export function confirmationKit() {
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
  return {
    sql,
    actions,
    plans,
    findings,
    keys,
    priv,
    pub,
    T0,
    S,
    run,
    made,
    freeTheWay,
    request,
    fieldsOf,
    signAction,
    STEPS,
    signedSteps,
    planFields,
    signPlan,
    asked,
    holding,
    aMoment,
  };
}
