/**
 * One full pass of Iris on the mail: collect what is new (every folder Iris
 * reads — ADR-0016 — and Sent, read-only), sort it by rules, then by the local model for the rest, and
 * publish the totals. Shared by `npm run mail:sort` and Iris's own rhythm.
 */
import { classifyMail, type LocalModels, type ModelSort, sortByModel } from "@cenacle/brain";
import type { Journal, LocationStore, MailStore } from "@cenacle/journal";
import type { MailCadre } from "./cadre.ts";
import { type CollectSummary, collectMail, mailTotals } from "./collect.ts";
import { keptFromModel } from "./floor.ts";
import { listFolders } from "./folders.ts";
import type { Keyer } from "./keys.ts";
import { createLocator, readMailsForSortingAt } from "./located.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { capped, ceilingOf, type Rules } from "./rules.ts";

export interface PassDeps {
  readonly journal: Journal;
  readonly store: MailStore;
  /** Where each remembered mail is, and how far each folder was read (ADR-0016). */
  readonly locations: LocationStore;
  readonly keyer: Keyer;
  readonly cadre: MailCadre;
  /** How long a mail is remembered, in days ([conservation] of cadre.toml). */
  readonly retentionDays: number;
  /** The opposition list (C3), read at each pass. */
  readonly opposedKeys: () => Promise<ReadonlySet<string>>;
  /** Moves the last trace of the opposed keys met (T-07). */
  readonly opposedSeen?: (traces: ReadonlyMap<string, Date>) => Promise<void>;
  /** C4: from when the mailbox may be read (readingStartsAt); null for the fictional box. */
  readonly notBefore: Date | null;
  readonly password: string;
  readonly rules: Rules;
  readonly noFollowUp: ReadonlySet<string>;
  /** The local model, or null to sort by rules only. */
  readonly local: LocalModels | null;
  /** Stands in for the model in tests; the real one otherwise. */
  readonly classify?: typeof classifyMail;
  readonly clock?: () => Date;
}

export interface PassResult {
  readonly collected: CollectSummary;
  /** Null when the model was not asked (rules only, or nothing left to sort). */
  readonly model: ModelSort | null;
}

export async function runMailPass(deps: PassDeps): Promise<PassResult> {
  const {
    journal,
    store,
    locations,
    keyer,
    cadre,
    password,
    local,
    clock = () => new Date(),
  } = deps;
  const collected = await collectMail({
    journal,
    store,
    rules: deps.rules,
    retentionDays: deps.retentionDays,
    opposedKeys: await deps.opposedKeys(),
    ...(deps.opposedSeen === undefined ? {} : { opposedSeen: deps.opposedSeen }),
    notBefore: deps.notBefore,
    noFollowUp: deps.noFollowUp,
    clock,
    folders: () => listFolders(cadre, password, keyer),
    fetchFolder: (path, afterUid) =>
      fetchMailRefs({ ...cadre, mailbox: path }, password, keyer, { afterUid }),
    locations,
    fetchSent: (afterUid) => fetchSentRefs(cadre, password, keyer, { afterUid }),
  });
  if (local === null || collected.uncategorized.length === 0) return { collected, model: null };

  const locator = createLocator({ cadre, password, keyer, locations });
  // The same source gives the model's view and the mass flag: a mail left from an
  // earlier pass gets its ceiling back without anything stored (ADR-0030).
  const sources = await readMailsForSortingAt(locator, cadre, password, collected.uncategorized);
  const read = sources.map((s) => s.view);
  const ceilings = new Map(
    sources.map((s) => [s.view.uid, ceilingOf(s.mass, s.view.domain, deps.rules)]),
  );
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
    // Capped before anything is stored or journaled: base, journal and counters agree.
    classify: async (mail, options) => {
      const r = await (deps.classify ?? classifyMail)(mail, options);
      return { ...r, category: capped(r.category, ceilings.get(mail.uid)) };
    },
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
