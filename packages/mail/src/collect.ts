/**
 * One collection pass by Iris: journaled, remembered, visible on her box.
 *
 * Each pass reads only what is new since the last one (inbox and Sent),
 * remembers it (keys only), sorts the new mails the rules know, and applies
 * the retention period. The journal gets facts, not content (charter): counts
 * and durations — never a UID, a domain or a key.
 */
import { countFollowUps } from "@cenacle/core";
import type { Journal, Mailbox, MailStore, Totals } from "@cenacle/journal";
import type { FetchResult, MailRef, SentRef } from "./postman.ts";
import { type RuleSort, type Rules, sortByRules } from "./rules.ts";

const AGENT = "iris";
export const RETENTION_DAYS = 90;
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
  readonly fetchInbox: (afterUid: number) => Promise<FetchResult<MailRef>>;
  readonly fetchSent: (afterUid: number) => Promise<FetchResult<SentRef>>;
  readonly rules: Rules;
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
    const inbox = await readNew(store, "inbox", deps.fetchInbox);
    const sent = await readNew(store, "sent", deps.fetchSent);
    // Mapped field by field: the domain is used for sorting below, never stored.
    const added = await store.saveInbox(
      inbox.result.uidValidity,
      inbox.result.refs.map(
        ({ uid, domain, receivedAt, urgentTerm, senderKey, messageKey, threadKeys }) => ({
          uid,
          receivedAt,
          noFollowUp: domain !== null && (deps.noFollowUp?.has(domain) ?? false),
          urgentTerm,
          senderKey,
          messageKey,
          threadKeys,
        }),
      ),
    );
    const sentAdded = await store.saveSent(
      sent.result.uidValidity,
      sent.result.refs.map(({ uid, sentAt, recipientKeys, messageKey, threadKeys }) => ({
        uid,
        sentAt,
        recipientKeys,
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
        truncated: inbox.result.truncated || sent.result.truncated,
        durationMs: Math.round(now() - started),
      },
    });

    const ruleSort = sortByRules(inbox.result.refs, rules);
    for (const { uid, category, decidedBy } of ruleSort.sorted) {
      await store.categorize(uid, category, decidedBy);
    }
    await journal.append({
      agent: AGENT,
      type: "mail.sorted_by_rules",
      payload: { ...ruleSort.counts },
    });

    // Deleted or moved on the server: forgotten here too (no reminder for a mail that is gone).
    const gone =
      (await store.keepOnly("inbox", inbox.result.present)) +
      (await store.keepOnly("sent", sent.result.present));
    const cutoff = new Date(clock().getTime() - RETENTION_DAYS * DAY_MS);
    const purged = (await store.purgeBefore(cutoff)) + inbox.forgotten + sent.forgotten + gone;
    await journal.append({
      agent: AGENT,
      type: "mail.totals",
      payload: { ...(await mailTotals(store, clock())) },
    });
    await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
    return {
      count: added,
      sentCount: sentAdded,
      truncated: inbox.result.truncated || sent.result.truncated,
      unseen: inbox.result.unseen,
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
