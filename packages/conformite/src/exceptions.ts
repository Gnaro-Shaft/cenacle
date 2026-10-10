/**
 * Known and accepted gaps (ADR-0022): docs/conformite/exceptions.md, a table
 * `| Contrôle | Sujet | Raison | Date |`. A gap listed there is excused; an
 * exception without a real reason or a date is itself a finding, and so is
 * one that no longer excuses anything — the list never silts up.
 */
import type { Finding } from "./checks.ts";
import { table } from "./markdown.ts";

export interface Exception {
  readonly check: string;
  readonly subject: string;
  readonly reason: string;
  readonly date: string;
}

const MIN_REASON = 20;

/** The exceptions file's table; no table at all means no exception. */
export function parseExceptions(markdown: string): Exception[] {
  if (!/^\|\s*Contrôle\s*\|/m.test(markdown)) return [];
  return table(markdown, "Contrôle", "docs/conformite/exceptions.md").map((r) => ({
    check: (r.Contrôle ?? "").replace(/`/g, ""),
    subject: (r.Sujet ?? "").replace(/`/g, ""),
    reason: r.Raison ?? "",
    date: r.Date ?? "",
  }));
}

export interface Verdict {
  /** Gaps that make the check fail. */
  readonly findings: readonly Finding[];
  /** Gaps excused by a valid exception. */
  readonly excused: readonly Finding[];
}

export function applyExceptions(
  found: readonly Finding[],
  exceptions: readonly Exception[],
): Verdict {
  const valid: Exception[] = [];
  const findings: Finding[] = [];
  for (const e of exceptions) {
    const subject = `${e.check} / ${e.subject}`;
    if (e.reason.trim().length < MIN_REASON) {
      findings.push({
        check: "format",
        subject,
        detail: `exception « ${subject} » sans vraie raison`,
      });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date.trim())) {
      findings.push({
        check: "format",
        subject,
        detail: `exception « ${subject} » sans date (AAAA-MM-JJ)`,
      });
    } else {
      valid.push(e);
    }
  }
  const excused: Finding[] = [];
  const used = new Set<Exception>();
  for (const f of found) {
    const e = valid.find((x) => x.check === f.check && x.subject === f.subject);
    if (e === undefined) findings.push(f);
    else {
      excused.push(f);
      used.add(e);
    }
  }
  for (const e of valid) {
    if (!used.has(e)) {
      const subject = `${e.check} / ${e.subject}`;
      findings.push({
        check: "format",
        subject,
        detail: `exception « ${subject} » n'excuse plus rien : à retirer`,
      });
    }
  }
  return { findings, excused };
}
