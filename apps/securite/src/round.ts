/**
 * One round of the security agent (J6a, ADR-0025): run the checks, reconcile
 * with what was known, ask the CTO a word on each new finding, send what
 * changed — and mark it told only once the message has left. Mondays, the
 * weekly review of everything open and accepted. Then the purge. Only counts
 * reach the journal.
 */
import type { Journal, SecuriteStore, StoredFinding } from "@cenacle/journal";
import {
  type CheckResult,
  formatDaily,
  formatWeekly,
  type ReportFinding,
  reconcile,
} from "@cenacle/securite";

const AGENT = "securite";
const WEEK_GAP_MS = 6 * 24 * 3_600_000;

export interface RoundDeps {
  readonly checks: () => Promise<CheckResult[]>;
  readonly store: SecuriteStore;
  /** The CTO's word on a finding; null when the local model is away (the round goes on). */
  readonly comment: (f: StoredFinding) => Promise<string | null>;
  /** Sends a message, with buttons for these findings still to fix (J6b). */
  readonly send: (text: string, buttonsFor: readonly number[]) => Promise<void>;
  readonly journal: Journal;
  readonly now: () => Date;
  /** When the last weekly review was sent, if ever. */
  readonly lastWeekly: () => Promise<Date | null>;
}

export interface RoundOutcome {
  readonly checks: number;
  readonly impossible: number;
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
  const results = await deps.checks();
  const active = (await deps.store.active()).flatMap((f) =>
    f.status === "resolu" || f.status === "caduc" ? [] : [{ ...f, status: f.status }],
  );
  await deps.store.apply(reconcile(active, results), now);

  const { opened, resolved } = await deps.store.toSignal();
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

  const last = await deps.lastWeekly();
  const weekly = isMonday(now) && (last === null || now.getTime() - last.getTime() > WEEK_GAP_MS);
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
    impossible: results.filter((r) => !r.ran).length,
    opened: daily === null ? 0 : opened.length,
    resolved: daily === null ? 0 : resolved.length,
    open: open.length,
    weekly,
    purged: await deps.store.purge(now),
  };
  await deps.journal.append({ agent: AGENT, type: "securite.ran", payload: { ...outcome } });
  return outcome;
}
