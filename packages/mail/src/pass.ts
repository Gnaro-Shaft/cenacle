/**
 * One full pass of Iris on the mail: collect what is new (inbox and Sent,
 * read-only), sort it by rules, then by the local model for the rest, and
 * publish the totals. Shared by `npm run mail:sort` and Iris's own rhythm.
 */
import { type LocalModels, type ModelSort, sortByModel } from "@cenacle/brain";
import type { Journal, MailStore } from "@cenacle/journal";
import type { MailCadre } from "./cadre.ts";
import { type CollectSummary, collectMail, mailTotals } from "./collect.ts";
import type { Keyer } from "./keys.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { readMailsForModel } from "./reader.ts";
import type { Rules } from "./rules.ts";

export interface PassDeps {
  readonly journal: Journal;
  readonly store: MailStore;
  readonly keyer: Keyer;
  readonly cadre: MailCadre;
  readonly password: string;
  readonly rules: Rules;
  readonly noFollowUp: ReadonlySet<string>;
  /** The local model, or null to sort by rules only. */
  readonly local: LocalModels | null;
  readonly clock?: () => Date;
}

export interface PassResult {
  readonly collected: CollectSummary;
  /** Null when the model was not asked (rules only, or nothing left to sort). */
  readonly model: ModelSort | null;
}

export async function runMailPass(deps: PassDeps): Promise<PassResult> {
  const { journal, store, keyer, cadre, password, local, clock = () => new Date() } = deps;
  const collected = await collectMail({
    journal,
    store,
    rules: deps.rules,
    noFollowUp: deps.noFollowUp,
    clock,
    fetchInbox: (afterUid) => fetchMailRefs(cadre, password, keyer, { afterUid }),
    fetchSent: (afterUid) => fetchSentRefs(cadre, password, keyer, { afterUid }),
  });
  if (local === null || collected.uncategorized.length === 0) return { collected, model: null };

  const mails = await readMailsForModel(cadre, password, collected.uncategorized);
  const model = await sortByModel(mails, {
    journal,
    local,
    onClassified: async (r) => {
      await store.categorize(r.uid, r.category, "model");
    },
  });
  await journal.append({
    agent: "iris",
    type: "mail.totals",
    payload: { ...(await mailTotals(store, clock())) },
  });
  return { collected, model };
}
