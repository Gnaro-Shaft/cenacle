/**
 * Where a pull request the agent opened stands (J6c), read from
 * `gh pr view --json state,statusCheckRollup`: merged, closed without
 * merging, its CI failed, or still waiting. Strict: an answer it does not
 * recognise is "unknown", and nothing is changed or said about it.
 */
export type PrStatus = "merged" | "closed" | "ci_failed" | "pending" | "ci_passed" | "unknown";

const FAILED = new Set([
  "FAILURE",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "ERROR",
]);

export function parsePrStatus(raw: string): PrStatus {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "unknown";
  }
  if (typeof data !== "object" || data === null) return "unknown";
  const d = data as { state?: unknown; statusCheckRollup?: unknown };
  if (d.state === "MERGED") return "merged";
  if (d.state === "CLOSED") return "closed";
  if (d.state !== "OPEN") return "unknown";
  const checks = Array.isArray(d.statusCheckRollup) ? d.statusCheckRollup : [];
  const results = checks.map((c) => {
    const x = (c ?? {}) as { conclusion?: unknown; state?: unknown; status?: unknown };
    return String(x.conclusion ?? x.state ?? "");
  });
  if (results.some((r) => FAILED.has(r))) return "ci_failed";
  if (
    results.length > 0 &&
    results.every((r) => r === "SUCCESS" || r === "NEUTRAL" || r === "SKIPPED")
  ) {
    return "ci_passed";
  }
  return "pending";
}

/** What a merge must check again, read strictly from `gh pr view --json …`. */
export interface PrView {
  readonly status: PrStatus;
  readonly headSha: string | null;
  readonly base: string | null;
  readonly files: readonly string[];
  readonly commits: number;
}

export const PR_VIEW_FIELDS = "state,statusCheckRollup,headRefOid,baseRefName,files,commits";
const SHA = /^[0-9a-f]{40}$/;
const UNKNOWN: PrView = { status: "unknown", headSha: null, base: null, files: [], commits: 0 };

export function parsePrView(raw: string): PrView {
  const status = parsePrStatus(raw);
  if (status === "unknown") return UNKNOWN;
  const d = JSON.parse(raw) as {
    headRefOid?: unknown;
    baseRefName?: unknown;
    files?: unknown;
    commits?: unknown;
  };
  const files = Array.isArray(d.files)
    ? d.files.flatMap((f) => {
        const path = (f as { path?: unknown } | null)?.path;
        return typeof path === "string" ? [path] : [];
      })
    : [];
  return {
    status,
    headSha: typeof d.headRefOid === "string" && SHA.test(d.headRefOid) ? d.headRefOid : null,
    base: typeof d.baseRefName === "string" ? d.baseRefName : null,
    files,
    commits: Array.isArray(d.commits) ? d.commits.length : 0,
  };
}
