/**
 * What a mailbox may do beyond reading (phase 5, M3 — ADR-0015), from
 * `[envoi]` and `[ouverture]`. Deny by default.
 *
 * - The fictional box and a real box marked `test = true` keep what they had
 *   (drafts; sends to test domains, or to my closed list).
 * - A real box is read-only (M2) until `[ouverture]` opens it, in two steps,
 *   each dated by my decision:
 *     brouillons = YYYY-MM-DD   Iris drafts (T-03); sends still go to my closed list only
 *     envoi      = YYYY-MM-DD   accepted replies go to the real correspondent (T-04)
 *   `envoi` without `brouillons`, or before it, or a date not reached yet, is refused.
 * - On a real box, a sender must be authenticated before a draft (and again
 *   before a send); at most `max_par_jour` sends a day (5 by default, 20 at
 *   most); a 10-minute undo delay instead of 2.
 */

export type Sending = "none" | "test-domains" | "closed" | "correspondents";

export interface Opening {
  /** Iris may draft replies. */
  readonly drafts: boolean;
  /** Where an accepted reply may go. */
  readonly sending: Sending;
  /** My closed list ([envoi] destinataires); null for the fictional box. */
  readonly recipients: readonly string[] | null;
  readonly maxPerDay: number;
  /** Undo delay after an acceptance, in ms. */
  readonly undoMs: number;
  /** A sender must be authenticated before a draft and a send. */
  readonly authRequired: boolean;
  /** The dates of my decisions, for the register; null when not opened. */
  readonly draftsSince: string | null;
  readonly sendingSince: string | null;
}

export const TEST_UNDO_MS = 2 * 60_000;
export const REAL_UNDO_MS = 10 * 60_000;
export const TEST_MAX_PER_DAY = 20;
export const REAL_DEFAULT_MAX_PER_DAY = 5;

export class OpeningError extends Error {
  constructor(message: string) {
    super(`cadre.toml: ${message}`);
    this.name = "OpeningError";
  }
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(table: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) throw new OpeningError(`unknown key "${key}" in ${where}`);
  }
}

const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/;

/** [envoi] destinataires: a non-empty list of plain addresses, required for a real box. */
function closedRecipients(envoi: Record<string, unknown>): string[] {
  const list = envoi.destinataires;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
    throw new OpeningError("envoi.destinataires must list 1 to 20 addresses");
  }
  return list.map((a) => {
    if (typeof a !== "string" || !PLAIN_ADDRESS.test(a)) {
      throw new OpeningError(`envoi.destinataires: invalid address ${JSON.stringify(a)}`);
    }
    return a.toLowerCase();
  });
}

function maxPerDay(envoi: Record<string, unknown>): number {
  const v = envoi.max_par_jour;
  if (v === undefined) return REAL_DEFAULT_MAX_PER_DAY;
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > TEST_MAX_PER_DAY) {
    throw new OpeningError(`envoi.max_par_jour must be an integer from 1 to ${TEST_MAX_PER_DAY}`);
  }
  return n;
}

/** A decision date: a TOML date (or YYYY-MM-DD), reached already. */
function decidedOn(v: unknown, key: string, today: string): string | null {
  if (v === undefined) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new OpeningError(`ouverture.${key} must be the date of my decision (YYYY-MM-DD)`);
  }
  if (s > today) throw new OpeningError(`ouverture.${key} ${s} is not reached yet`);
  return s;
}

export function parseOpening(
  raw: { readonly envoi?: unknown; readonly ouverture?: unknown },
  box: { readonly fictional: boolean; readonly test: boolean },
  today: string,
): Opening {
  if (raw.ouverture !== undefined && (box.fictional || box.test)) {
    throw new OpeningError("[ouverture] is for a real mailbox only: a test box is open already");
  }
  if (box.fictional) {
    return {
      drafts: true,
      sending: "test-domains",
      recipients: null,
      maxPerDay: TEST_MAX_PER_DAY,
      undoMs: TEST_UNDO_MS,
      authRequired: false,
      draftsSince: null,
      sendingSince: null,
    };
  }
  if (!isTable(raw.envoi)) {
    throw new OpeningError(
      "a real mailbox needs [envoi] destinataires: the only addresses a reply may go to",
    );
  }
  onlyKeys(raw.envoi, ["destinataires", "max_par_jour"], "[envoi]");
  const recipients = closedRecipients(raw.envoi);
  if (box.test) {
    if (raw.envoi.max_par_jour !== undefined) {
      throw new OpeningError("envoi.max_par_jour is for a real mailbox only");
    }
    return {
      drafts: true,
      sending: "closed",
      recipients,
      maxPerDay: TEST_MAX_PER_DAY,
      undoMs: TEST_UNDO_MS,
      authRequired: false,
      draftsSince: null,
      sendingSince: null,
    };
  }
  let draftsSince: string | null = null;
  let sendingSince: string | null = null;
  if (raw.ouverture !== undefined) {
    if (!isTable(raw.ouverture)) throw new OpeningError("[ouverture] must be a section");
    onlyKeys(raw.ouverture, ["brouillons", "envoi"], "[ouverture]");
    draftsSince = decidedOn(raw.ouverture.brouillons, "brouillons", today);
    sendingSince = decidedOn(raw.ouverture.envoi, "envoi", today);
    if (sendingSince !== null && (draftsSince === null || sendingSince < draftsSince)) {
      throw new OpeningError("ouverture.envoi needs ouverture.brouillons, decided on or before it");
    }
  }
  return {
    drafts: draftsSince !== null,
    sending: sendingSince !== null ? "correspondents" : draftsSince !== null ? "closed" : "none",
    recipients,
    maxPerDay: maxPerDay(raw.envoi),
    undoMs: REAL_UNDO_MS,
    authRequired: true,
    draftsSince,
    sendingSince,
  };
}
