/**
 * One collection pass by Iris: journaled, remembered, visible on her box.
 *
 * Each pass reads only what is new since the last one (every folder Iris
 * reads — ADR-0016 — and Sent),
 * remembers it (keys only), sorts the new mails the rules know, and applies
 * the retention period of cadre.toml ([conservation], memoire_jours). The journal gets facts, not content (charter): counts
 * and durations — never a UID, a domain or a key.
 */
import { countFollowUps } from "@cenacle/core";
import {
  type Journal,
  type LocationStore,
  type Mailbox,
  type MailStore,
  type Totals,
  VIRTUAL_UID_VALIDITY,
} from "@cenacle/journal";
import { locKey, placeRefs, readFolders } from "./collect-folders.ts";
import type { Folder } from "./folders.ts";
import type { FetchResult, MailRef, SentRef } from "./postman.ts";
import { type RuleSort, type Rules, sortByRules } from "./rules.ts";
import { AUTH_VERDICTS, type AuthVerdict, hasTrustedHeader } from "./sender-auth.ts";

const AGENT = "iris";
const DAY_MS = 24 * 3600 * 1000;

export interface CollectSummary {
  /** New incoming mails this pass. */
  readonly count: number;
  /** New mails of mine read from Sent this pass. */
  readonly sentCount: number;
  readonly truncated: boolean;
  readonly unseen: number;
  readonly durationMs: number;
  readonly ruleSort: RuleSort;
  /** Inbox mails still without a category (new or older): for the model. */
  readonly uncategorized: readonly number[];
  /** Rows deleted: retention, mails gone from the server, or a renumbered mailbox. */
  readonly purged: number;
}

export interface CollectDeps {
  readonly journal: Journal;
  readonly store: MailStore;
  /** The folders Iris reads (folders.ts), and where each remembered mail is. */
  readonly folders: () => Promise<readonly Folder[]>;
  readonly fetchFolder: (path: string, afterUid: number) => Promise<FetchResult<MailRef>>;
  readonly locations: LocationStore;
  readonly fetchSent: (afterUid: number) => Promise<FetchResult<SentRef>>;
  readonly rules: Rules;
  /** How long a mail is remembered after its arrival, in days (cadre.toml). */
  readonly retentionDays: number;
  /** People who asked to be erased or objected (C3): their mails are never remembered. */
  readonly opposedKeys: ReadonlySet<string>;
  /** Each opposed key met, with its latest mail's date: the list's last trace (T-07). */
  readonly opposedSeen?: (traces: ReadonlyMap<string, Date>) => Promise<void>;
  /** C4: mails (received or sent) before the notice was published are not read; null: no limit. */
  readonly notBefore: Date | null;
  /** Domains that never expect a reply by mail ([sans_suivi]). */
  readonly noFollowUp?: ReadonlySet<string>;
  readonly clock?: () => Date;
  readonly now?: () => number;
}

/** What the box shows: mails per category, plus who still waits for my reply. */
export async function mailTotals(
  store: MailStore,
  now: Date,
): Promise<Totals & { readonly waiting: number; readonly due: number }> {
  const followUps = countFollowUps(await store.inbox(), await store.sent(), now);
  return { ...(await store.totals()), waiting: followUps.waiting, due: followUps.due };
}

/**
 * How many new mails got each authentication verdict (ADR-0014), and how many
 * carried our server's header where expected: none at all in a pass with mails
 * means the evidence is gone (provider change?) — Iris shows sick.
 */
export function authCounts(refs: readonly { readonly auth: AuthVerdict }[]) {
  const counts = Object.fromEntries(AUTH_VERDICTS.map((v) => [v, 0])) as Record<
    AuthVerdict,
    number
  >;
  for (const ref of refs) counts[ref.auth]++;
  return {
    mails: refs.length,
    trusted: refs.filter((r) => hasTrustedHeader(r.auth)).length,
    ...counts,
  };
}

/** Reads what is new; if the server renumbered the mailbox, forgets it and reads it all. */
async function readNew<T>(
  store: MailStore,
  mailbox: Mailbox,
  fetch: (afterUid: number) => Promise<FetchResult<T>>,
): Promise<{ result: FetchResult<T>; forgotten: number }> {
  const position = await store.position(mailbox);
  const result = await fetch(position?.lastUid ?? 0);
  if (position === null || result.uidValidity === position.uidValidity) {
    return { result, forgotten: 0 };
  }
  const forgotten = await store.forget(mailbox);
  return { result: await fetch(0), forgotten };
}

export async function collectMail(deps: CollectDeps): Promise<CollectSummary> {
  const { journal, store, rules, clock = () => new Date(), now = () => performance.now() } = deps;
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "reading" } });
  const started = now();
  try {
    // Once: received mails remembered under a server's numbering (before ADR-0016) are
    // forgotten and read again under Iris's own ids.
    const before = await store.position("inbox");
    const reset =
      before !== null && before.uidValidity !== VIRTUAL_UID_VALIDITY
        ? await store.forget("inbox")
        : 0;
    // A location saved by a pass that failed before its mail: dropped, the mail is read again.
    await deps.locations.keepOnly((await store.inbox()).map((m) => m.uid));
    const read = await readFolders(await deps.folders(), deps.locations, deps.fetchFolder);
    const sent = await readNew(store, "sent", deps.fetchSent);
    // C3: an opposed person's mails are not remembered, sorted nor read; in my
    // sent mails, only their key is left out (the other recipients stay).
    const opposed = deps.opposedKeys;
    // C4: nothing from before the information notice; null for the fictional box.
    const since = deps.notBefore?.getTime() ?? Number.NEGATIVE_INFINITY;
    // Their last trace: the date of the latest mail met from or to them — nothing else.
    const traces = new Map<string, Date>();
    const met = (key: string | null, at: string) => {
      const date = new Date(at);
      if (key === null || !opposed.has(key) || Number.isNaN(date.getTime())) return;
      const before = traces.get(key);
      if (before === undefined || date > before) traces.set(key, date);
    };
    for (const r of read.refs) met(r.senderKey, r.receivedAt);
    for (const r of sent.result.refs) for (const k of r.recipientKeys) met(k, r.sentAt);
    if (traces.size > 0) await deps.opposedSeen?.(traces);
    const kept = read.refs.filter(
      (r) =>
        (r.senderKey === null || !opposed.has(r.senderKey)) && Date.parse(r.receivedAt) >= since,
    );
    // A moved mail keeps its id and all Iris knows of it; only new ones get an id.
    const placed = await placeRefs(kept, read.present, deps.locations, store);
    const inboxRefs: MailRef[] = [];
    for (const ref of placed.fresh) {
      const { location, ...rest } = ref;
      inboxRefs.push({ ...rest, uid: await deps.locations.add(location, ref.messageKey) });
    }
    const sentRefs = sent.result.refs.filter((r) => Date.parse(r.sentAt) >= since);
    // Mapped field by field: the domain is used for sorting below, never stored.
    const added = await store.saveInbox(
      VIRTUAL_UID_VALIDITY,
      inboxRefs.map(
        ({ uid, domain, receivedAt, urgentTerm, auth, senderKey, messageKey, threadKeys }) => ({
          uid,
          receivedAt,
          noFollowUp: domain !== null && (deps.noFollowUp?.has(domain) ?? false),
          urgentTerm,
          senderAuthenticated: auth === "authenticated",
          senderKey,
          messageKey,
          threadKeys,
        }),
      ),
    );
    const sentAdded = await store.saveSent(
      sent.result.uidValidity,
      sentRefs.map(({ uid, sentAt, recipientKeys, messageKey, threadKeys }) => ({
        uid,
        sentAt,
        recipientKeys: recipientKeys.filter((k) => !opposed.has(k)),
        messageKey,
        threadKeys,
      })),
    );
    await journal.append({
      agent: AGENT,
      type: "mail.fetched",
      payload: {
        count: added,
        sent: sentAdded,
        moved: placed.moved,
        copies: placed.copies,
        folders: read.cursors.length,
        truncated: read.truncated || sent.result.truncated,
        durationMs: Math.round(now() - started),
      },
    });

    const ruleSort = sortByRules(inboxRefs, rules);
    for (const { uid, category, decidedBy } of ruleSort.sorted) {
      await store.categorize(uid, category, decidedBy);
    }
    await journal.append({
      agent: AGENT,
      type: "mail.sorted_by_rules",
      payload: { ...ruleSort.counts },
    });
    if (inboxRefs.length > 0) {
      await journal.append({
        agent: AGENT,
        type: "mail.sender_auth",
        payload: authCounts(inboxRefs),
      });
    }

    // Deleted on the server, or moved to a folder Iris does not read: forgotten here too.
    const stillThere = (await deps.locations.all())
      .filter((l) => read.present.has(locKey(l)))
      .map((l) => l.id);
    const gone =
      (await store.keepOnly("inbox", stillThere)) +
      (await store.keepOnly("sent", sent.result.present));
    await deps.locations.keepOnly(stillThere);
    // Only now, with the mails saved: the next pass starts after them.
    for (const { folderKey, cursor } of read.cursors)
      await deps.locations.setCursor(folderKey, cursor);
    await deps.locations.keepCursors(read.cursors.map((c) => c.folderKey));
    const cutoff = new Date(clock().getTime() - deps.retentionDays * DAY_MS);
    const purged = (await store.purgeBefore(cutoff)) + reset + sent.forgotten + gone;
    await journal.append({
      agent: AGENT,
      type: "mail.totals",
      payload: { ...(await mailTotals(store, clock())) },
    });
    await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
    return {
      count: added,
      sentCount: sentAdded,
      truncated: read.truncated || sent.result.truncated,
      unseen: read.unseen,
      durationMs: Math.round(now() - started),
      ruleSort,
      uncategorized: await store.uncategorized(),
      purged,
    };
  } catch (error) {
    // No message: an IMAP error may echo server data. The name is enough to start looking.
    const reason = error instanceof Error ? error.name : "unknown";
    await journal.append({ agent: AGENT, type: "mail.fetch_failed", payload: { reason } });
    await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "error" } });
    throw error;
  }
}
