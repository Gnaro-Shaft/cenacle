/**
 * The counters shown on Iris's box: the mails Iris remembers, per category.
 *
 * Built from journal events only, like the rest of the status (ADR-0008).
 * Counts, never content: no UID, no domain, no subject ever reaches them.
 */
import { CATEGORIES, type Category, MODEL_CATEGORIES, type ModelCategory } from "./fixtures.ts";

export type MailCounts = Readonly<Record<Category, number>> & {
  /** Mails of this pass not sorted yet (left for the model, or waiting for the Mac). */
  readonly pending: number;
  /** Client/prospect mails waiting for my reply, less than 48 working hours old. */
  readonly waiting: number;
  /** Client/prospect mails without my reply after 48 working hours: reminders due. */
  readonly due: number;
};

export class MailCountsError extends Error {}

function count(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MailCountsError(`invalid ${key} ${JSON.stringify(value)}`);
  }
  return value;
}

/** A count added after the first events existed: absent means 0, invalid is refused. */
function laterCount(payload: Readonly<Record<string, unknown>>, key: string): number {
  return payload[key] === undefined ? 0 : count(payload, key);
}

/** A box the base may hold, but the model never answers "missions" (ADR-0031). */
function isModelCategory(value: unknown): value is ModelCategory {
  return typeof value === "string" && (MODEL_CATEGORIES as readonly string[]).includes(value);
}

/** Boxes added after the first events existed: absent from older payloads. */
const LATER_CATEGORIES: ReadonlySet<Category> = new Set(["missions"]);

function categoryCount(payload: Readonly<Record<string, unknown>>, category: Category): number {
  return LATER_CATEGORIES.has(category) ? laterCount(payload, category) : count(payload, category);
}

const EMPTY = {
  clients_prospects: 0,
  administratif: 0,
  bruit: 0,
  missions: 0,
  a_trier: 0,
  waiting: 0,
  due: 0,
} as const;

/**
 * A pass fetched new mails: they are pending until sorted.
 * (Counters are the totals of what Iris remembers; a pass adds to them.)
 */
export function startPass(
  counts: MailCounts | null,
  payload: Readonly<Record<string, unknown>>,
): MailCounts {
  const base = counts ?? { ...EMPTY, pending: 0 };
  return { ...base, pending: base.pending + count(payload, "count") };
}

/** The rules sorted some pending mails; the rest stays pending, for the model. */
export function applyRuleSort(
  counts: MailCounts | null,
  payload: Readonly<Record<string, unknown>>,
): MailCounts {
  if (counts === null) throw new MailCountsError("rules sorted mails before any fetch");
  const next = { ...counts };
  let sorted = 0;
  for (const category of CATEGORIES) {
    const n = categoryCount(payload, category);
    next[category] += n;
    sorted += n;
  }
  count(payload, "remaining");
  if (sorted > counts.pending) {
    throw new MailCountsError(
      `rules sorted ${sorted} mails, but only ${counts.pending} were pending`,
    );
  }
  return { ...next, pending: counts.pending - sorted };
}

/** The model sorted one mail. */
export function applyModelSort(
  counts: MailCounts | null,
  payload: Readonly<Record<string, unknown>>,
): MailCounts {
  if (counts === null || counts.pending === 0) {
    throw new MailCountsError("the model sorted a mail that was not pending");
  }
  const category = payload.category;
  if (!isModelCategory(category))
    throw new MailCountsError(`unknown category ${JSON.stringify(category)}`);
  return { ...counts, [category]: counts[category] + 1, pending: counts.pending - 1 };
}

/** The exact totals of what Iris remembers (end of a pass, after retention). */
export function applyTotals(payload: Readonly<Record<string, unknown>>): MailCounts {
  return {
    clients_prospects: count(payload, "clients_prospects"),
    administratif: count(payload, "administratif"),
    bruit: count(payload, "bruit"),
    missions: laterCount(payload, "missions"),
    a_trier: count(payload, "a_trier"),
    pending: count(payload, "pending"),
    waiting: laterCount(payload, "waiting"),
    due: laterCount(payload, "due"),
  };
}
