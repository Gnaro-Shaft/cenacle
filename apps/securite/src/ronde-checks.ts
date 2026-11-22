/**
 * The servers, as the ronde sees them (ADR-0040): one check, every round.
 *
 * `legion_ronde` — the id kept after R4 (22/11/2026), so that the findings'
 * history, severity and cadence stay theirs: the verdict of Cénacle's ronde,
 * at its own age limit, when securite.toml names it. A source that cannot be
 * read is no source: the check could not run. The comparison with Legion's
 * ronde (`ronde_comparaison`) ended with Legion.
 *
 * Read in process (the verdict is a file of mine), never through a program.
 */
import {
  type CheckResult,
  parseLegionVerdict,
  parseRondeSource,
  RONDE_SOURCES,
} from "@cenacle/securite";

export const SERVERS_CHECK = "legion_ronde";

/** A file's text, or null when it is absent; may throw when it cannot be read. */
export type ReadFile = (path: string) => string | null;

/** `securiteToml`: the file's text, or null when it is missing (then no source at all). */
export function rondeResults(
  read: ReadFile,
  securiteToml: string | null,
  nowMs: number,
): CheckResult[] {
  const source = parseRondeSource(securiteToml);
  if (source === null) return [{ check: SERVERS_CHECK, ran: false }];
  let raw: string | null;
  try {
    raw = read(RONDE_SOURCES[source].path);
  } catch {
    raw = null;
  }
  if (raw === null) return [{ check: SERVERS_CHECK, ran: false }];
  try {
    const observations = parseLegionVerdict(raw, nowMs, RONDE_SOURCES[source].staleMs);
    return [{ check: SERVERS_CHECK, ran: true, observations }];
  } catch {
    // Cut short, out of shape, too old or from the future: proves nothing.
    return [{ check: SERVERS_CHECK, ran: false }];
  }
}
