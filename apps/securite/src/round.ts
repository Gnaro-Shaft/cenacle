/**
 * One round of the security agent (J6a, ADR-0025; Legion's ronde), every 15
 * minutes: the local checks each time, the network ones at most once an
 * hour; reconcile with what was known. A new finding speaks at once when it
 * is serious (critical at any hour, high outside quiet hours); the rest waits
 * for the morning report, sent by the first round after 7:30, once a day —
 * with the Monday review. Told only once the message has left. Then the
 * purge. Only counts reach the journal.
 */
import type { Journal, SecuriteStore, StoredFinding } from "@cenacle/journal";
import {
  type CheckResult,
  formatDaily,
  formatWeekly,
  networkDue,
  type ReportFinding,
  reconcile,
  reportDue,
  urgentNow,
} from "@cenacle/securite";

const AGENT = "securite";
const WEEK_GAP_MS = 6 * 24 * 3_600_000;

export interface RoundDeps {
  /** Runs the checks: the local ones always, the network ones when asked. */
  readonly checks: (network: boolean) => Promise<CheckResult[]>;
  readonly store: SecuriteStore;
  /** The CTO's word on a finding; null when the local model is away (the round goes on). */
  readonly comment: (f: StoredFinding) => Promise<string | null>;
  /** Sends a message, with buttons for these findings still to fix (J6b). */
  readonly send: (text: string, buttonsFor: readonly number[]) => Promise<void>;
  readonly journal: Journal;
  readonly now: () => Date;
  /** When the network checks last ran, the morning report and the weekly review were sent. */
  readonly lastNetwork: () => Promise<Date | null>;
  readonly lastReport: () => Promise<Date | null>;
  readonly lastWeekly: () => Promise<Date | null>;
}

export interface RoundOutcome {
  readonly checks: number;
  readonly network: boolean;
  readonly impossible: number;
  /** New findings told at once, for their severity. */
  readonly urgent: number;
  /** The morning report was sent by this round. */
  readonly report: boolean;
  readonly opened: number;
  readonly resolved: number;
  readonly open: number;
  readonly weekly: boolean;
  readonly purged: number;
}

const report = (f: StoredFinding, comment?: string | null): ReportFinding => ({
  id: f.id,
  type: f.type,
  target: f.target,
  occurrence: f.occurrence,
  severity: f.severity,
  title: f.title,
  params: f.params,
  firstSeen: f.firstSeen,
  comment: comment ?? null,
  takenAt: f.status === "pris_en_charge" ? f.decidedAt : null,
});

const isMonday = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" }).format(d) ===
  "Mon";

export async function runRound(deps: RoundDeps): Promise<RoundOutcome> {
  const now = deps.now();
  const network = networkDue(now, await deps.lastNetwork());
  const results = await deps.checks(network);
  const active = (await deps.store.active()).flatMap((f) =>
    f.status === "resolu" || f.status === "caduc" ? [] : [{ ...f, status: f.status }],
  );
  await deps.store.apply(reconcile(active, results), now);

  const pending = await deps.store.toSignal();
  const isReport = reportDue(now, await deps.lastReport());
  // The report tells everything not told yet; otherwise only what cannot wait.
  const opened = isReport
    ? pending.opened
    : pending.opened.filter((f) => urgentNow(f.severity, now));
  const resolved = isReport ? pending.resolved : [];
  const comments = new Map<number, string | null>();
  for (const f of opened) comments.set(f.id, await deps.comment(f));
  const open = await deps.store.open();
  const daily = formatDaily({
    date: now,
    opened: opened.map((f) => report(f, comments.get(f.id))),
    resolved: resolved.map((f) => report(f)),
    openTotal: open.length,
  });
  if (daily !== null) {
    // Told once it has left: a message that fails is sent again next round.
    await deps.send(
      daily,
      opened.map((f) => f.id),
    );
    await deps.store.markSignaled(
      opened.map((f) => f.id),
      resolved.map((f) => f.id),
    );
  }
  if (isReport) {
    await deps.journal.append({
      agent: AGENT,
      type: "securite.rapport",
      payload: { opened: opened.length, resolved: resolved.length },
    });
  }

  const last = await deps.lastWeekly();
  const weekly =
    isReport && isMonday(now) && (last === null || now.getTime() - last.getTime() > WEEK_GAP_MS);
  if (weekly) {
    const accepted = await deps.store.accepted();
    const toFix = open.filter((f) => f.status === "ouvert").map((f) => f.id);
    await deps.send(
      formatWeekly({
        date: now,
        open: open.map((f) => report(f)),
        accepted: accepted.map((f) => ({
          ...report(f),
          reason: f.reason ?? "",
          acceptedAt: f.acceptedAt ?? now,
        })),
      }),
      toFix,
    );
    await deps.journal.append({
      agent: AGENT,
      type: "securite.bilan",
      payload: { open: open.length, accepted: accepted.length },
    });
  }

  const outcome = {
    checks: results.length,
    network,
    impossible: results.filter((r) => !r.ran).length,
    urgent: isReport || daily === null ? 0 : opened.length,
    report: isReport,
    opened: daily === null ? 0 : opened.length,
    resolved: daily === null ? 0 : resolved.length,
    open: open.length,
    weekly,
    purged: await deps.store.purge(now),
  };
  await deps.journal.append({ agent: AGENT, type: "securite.ran", payload: { ...outcome } });
  return outcome;
}
