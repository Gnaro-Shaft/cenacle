/**
 * The sorting measure's replay (mesure:rangement --simuler): what today's
 * sorting would decide for a mail Iris already sorted. Production's order,
 * with production's own parts (packages/mail/src/pass.ts): the rules — my
 * real ones, the mass flag (ADR-0029), the authentication kept in base
 * (ADR-0014) — then the article 9 floor, then the local model.
 *
 * Decides nothing: the result is shown next to Iris's decision, never stored.
 * If the model stops answering, the replay stops (ModelUnavailableError): a
 * half-measured replay would not be the measure it claims to be.
 */
import type { Category, MailForModel } from "@cenacle/core";
import {
  capped,
  ceilingOf,
  type Decider,
  keptFromModel,
  type Rules,
  sortByRules,
} from "@cenacle/mail";

export interface ToReplay {
  readonly view: MailForModel;
  readonly mass: boolean;
  readonly senderAuthenticated: boolean;
}

export interface Replayed {
  readonly category: Category;
  readonly decidedBy: Decider;
}

export type Classify = (view: MailForModel) => Promise<{ readonly category: Category }>;

export async function replaySorting(
  mails: readonly ToReplay[],
  rules: Rules,
  classify: Classify,
  onModel?: (done: number, total: number) => void,
): Promise<Map<number, Replayed>> {
  const out = new Map<number, Replayed>();
  const views = new Map(mails.map((m) => [m.view.uid, m.view]));
  const ceilings = new Map(mails.map((m) => [m.view.uid, ceilingOf(m.mass, m.view.domain, rules)]));
  const ruleSort = sortByRules(
    mails.map((m) => ({
      uid: m.view.uid,
      domain: m.view.domain,
      // Only "authenticated" matters to the rules; any other verdict refuses a client rule.
      auth: m.senderAuthenticated ? ("authenticated" as const) : ("failed" as const),
      mass: m.mass,
    })),
    rules,
  );
  for (const { uid, category, decidedBy } of ruleSort.sorted) out.set(uid, { category, decidedBy });
  const left = ruleSort.remaining.flatMap((r) => {
    const view = views.get(r.uid);
    return view === undefined ? [] : [view];
  });
  // C2: the floor before the model, exactly as in production.
  for (const view of left.filter(keptFromModel)) {
    out.set(view.uid, { category: "a_trier", decidedBy: "set_aside" });
  }
  const toModel = left.filter((v) => !keptFromModel(v));
  for (const [i, view] of toModel.entries()) {
    const { category } = await classify(view);
    // ADR-0030: as in production, never above the rule of a mass mail's domain.
    out.set(view.uid, { category: capped(category, ceilings.get(view.uid)), decidedBy: "model" });
    onModel?.(i + 1, toModel.length);
  }
  return out;
}
