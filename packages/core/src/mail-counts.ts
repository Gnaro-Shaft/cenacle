/**
 * The counters shown on Iris's box: the mails Iris remembers, per category.
 *
 * Built from journal events only, like the rest of the status (ADR-0008).
 * Counts, never content: no UID, no domain, no subject ever reaches them.
 */
import { CATEGORIES, type Category } from "./fixtures.ts";

export type MailCounts = Readonly<Record<Category, number>> & {
  /** Mails of this pass not sorted yet (left for the model, or waiting for the Mac). */
  readonly pending: number;
};

export class MailCountsError extends Error {}

function count(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MailCountsError(`invalid ${key} ${JSON.stringify(value)}`);
  }
  return value;
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

const EMPTY = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0 } as const;

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
    const n = count(payload, category);
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
  if (!isCategory(category))
    throw new MailCountsError(`unknown category ${JSON.stringify(category)}`);
  return { ...counts, [category]: counts[category] + 1, pending: counts.pending - 1 };
}

/** The exact totals of what Iris remembers (end of a pass, after retention). */
export function applyTotals(payload: Readonly<Record<string, unknown>>): MailCounts {
  return {
    clients_prospects: count(payload, "clients_prospects"),
    administratif: count(payload, "administratif"),
    bruit: count(payload, "bruit"),
    a_trier: count(payload, "a_trier"),
    pending: count(payload, "pending"),
  };
}
