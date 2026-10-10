/**
 * Iris's daily purge (phase 5, C1 — ADR-0009). Once a day, the retentions of
 * cadre.toml are applied to what the mail pass does not purge by itself:
 * - the text of proposals closed for `texte_brouillon_jours`;
 * - closed proposals, `propositions_jours` after closing;
 * - journal events older than `journal_jours`;
 * - opposed keys whose last trace is older than `opposition_jours` (T-07).
 * The mail memory is purged at each collection (collect.ts). What was purged
 * is journaled as counts, never as content. A failure is said, never hidden,
 * and does not stop the rhythm: the next minute tries again.
 */
import type { Journal, Purges, StoredEvent } from "@cenacle/journal";
import type { Conservation } from "@cenacle/mail";

const AGENT = "iris";
const DAY_MS = 24 * 3600 * 1000;

export interface PurgeDeps {
  readonly now: () => Date;
  readonly journal: Journal;
  /** Iris's journal events, oldest first. */
  readonly events: () => Promise<readonly StoredEvent[]>;
  readonly conservation: Conservation;
  readonly wipeTexts: (now: Date, days: number) => Promise<number>;
  readonly purges: Purges;
}

export interface PurgeResult {
  readonly texts: number;
  readonly proposals: number;
  readonly events: number;
  readonly opposition: number;
}

/** Runs the purge if the last one is a day old (or never ran); null otherwise. */
export async function purgeDue(deps: PurgeDeps): Promise<PurgeResult | null> {
  const now = deps.now();
  const last = (await deps.events()).findLast((e) => e.type === "purge.done");
  if (last !== undefined && now.getTime() - last.occurredAt.getTime() < DAY_MS) return null;
  const c = deps.conservation;
  try {
    const result = {
      texts: await deps.wipeTexts(now, c.texteBrouillonJours),
      proposals: await deps.purges.proposals(
        new Date(now.getTime() - c.propositionsJours * DAY_MS),
      ),
      events: await deps.purges.events(new Date(now.getTime() - c.journalJours * DAY_MS)),
      opposition: await deps.purges.opposition(
        new Date(now.getTime() - c.oppositionJours * DAY_MS),
      ),
    };
    await deps.journal.append({ agent: AGENT, type: "purge.done", payload: { ...result } });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    await deps.journal.append({ agent: AGENT, type: "purge.failed", payload: { reason } });
    throw error;
  }
}
