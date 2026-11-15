/**
 * The servers, as the ronde sees them (ADR-0040, R3): two checks, every round.
 *
 * - `legion_ronde` (the id kept until R4, so that open findings stay theirs):
 *   the verdict of the source securite.toml names, at that source's own age
 *   limit. A source that cannot be read is no source: the check could not run.
 * - `ronde_comparaison`: both verdicts side by side while both rondes run,
 *   each difference a finding said once. One missing: could not run.
 *
 * Read in process (the verdicts are files of mine), never through a program.
 */
import {
  type CheckResult,
  COMPARE_CHECK,
  compareVerdicts,
  LEGION_VERDICT_PATH,
  parseLegionVerdict,
  parseRondeSource,
  RONDE_SOURCES,
  RONDE_VERDICT_PATH,
} from "@cenacle/securite";

export const SERVERS_CHECK = "legion_ronde";

/** A file's text, or null when it is absent; may throw when it cannot be read. */
export type ReadFile = (path: string) => string | null;

const failed = (check: string): CheckResult => ({ check, ran: false });

export function rondeResults(read: ReadFile, securiteToml: string, nowMs: number): CheckResult[] {
  const safe = (path: string): string | null => {
    try {
      return read(path);
    } catch {
      return null;
    }
  };
  const legion = safe(LEGION_VERDICT_PATH);
  const cenacle = safe(RONDE_VERDICT_PATH);

  let servers = failed(SERVERS_CHECK);
  const source = parseRondeSource(securiteToml);
  const raw = source === "legion" ? legion : source === "cenacle" ? cenacle : null;
  if (source !== null && raw !== null) {
    try {
      const observations = parseLegionVerdict(raw, nowMs, RONDE_SOURCES[source].staleMs);
      servers = { check: SERVERS_CHECK, ran: true, observations };
    } catch {
      // Cut short, out of shape, too old or from the future: proves nothing.
    }
  }

  let compared = failed(COMPARE_CHECK);
  if (legion !== null && cenacle !== null) {
    try {
      const observations = compareVerdicts(legion, cenacle, nowMs);
      compared = { check: COMPARE_CHECK, ran: true, observations };
    } catch {
      // One of the two unreadable or too old: no difference is proved either way.
    }
  }
  return [servers, compared];
}
