/**
 * One full pass of Iris on the mail: collect what is new (inbox and Sent,
 * read-only), sort it by rules, then by the local model for the rest, and
 * publish the totals. Shared by `npm run mail:sort` and Iris's own rhythm.
 */
import { type LocalModels, type ModelSort, sortByModel } from "@cenacle/brain";
import type { Journal, MailStore } from "@cenacle/journal";
import type { MailCadre } from "./cadre.ts";
import { type CollectSummary, collectMail, mailTotals } from "./collect.ts";
import { keptFromModel } from "./floor.ts";
import type { Keyer } from "./keys.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { readMailsForModel } from "./reader.ts";
import type { Rules } from "./rules.ts";

export interface PassDeps {
  readonly journal: Journal;
  readonly store: MailStore;
  readonly keyer: Keyer;
  readonly cadre: MailCadre;
  /** How long a mail is remembered, in days ([conservation] of cadre.toml). */
  readonly retentionDays: number;
  /** The opposition list (C3), read at each pass. */
  readonly opposedKeys: () => Promise<ReadonlySet<string>>;
  /** C4: from when the mailbox may be read (readingStartsAt); null for the fictional box. */
  readonly notBefore: Date | null;
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
    retentionDays: deps.retentionDays,
    opposedKeys: await deps.opposedKeys(),
    notBefore: deps.notBefore,
    noFollowUp: deps.noFollowUp,
    clock,
    fetchInbox: (afterUid) => fetchMailRefs(cadre, password, keyer, { afterUid }),
    fetchSent: (afterUid) => fetchSentRefs(cadre, password, keyer, { afterUid }),
  });
  if (local === null || collected.uncategorized.length === 0) return { collected, model: null };

  const read = await readMailsForModel(cadre, password, collected.uncategorized);
  // C2: the article 9 floor (and empty or unreadable mails) — never given to the
  // model, put in "À trier" for me, with one mark that does not say why.
  const setAside = read.filter(keptFromModel);
  for (const mail of setAside) await store.categorize(mail.uid, "a_trier", "set_aside");
  if (setAside.length > 0) {
    await journal.append({
      agent: "iris",
      type: "mail.set_aside",
      payload: { count: setAside.length },
    });
  }
  const mails = read.filter((m) => !keptFromModel(m));
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
