/**
 * Which ronde's verdict Cénacle believes (ADR-0040, R3): `[ronde] source` in
 * securite.toml, "legion" or "cenacle". Absent, it is Legion's, as before the
 * ronde of Cénacle existed; anything else — a typo, a file that does not
 * parse — is refused: no machine is judged from a source nobody chose, and
 * the operator does not act. Switching back is the same line.
 */
import { parse } from "smol-toml";
import { LEGION_STALE_MS, LEGION_VERDICT_PATH } from "./parse-legion.ts";
import { RONDE_VERDICT_PATH } from "./ronde-verdict.ts";
import { verdictInstant } from "./servers.ts";

export type RondeSource = "legion" | "cenacle";

/** Four passes of Cénacle's ronde missed (ADR-0040, point 5). */
export const CENACLE_STALE_MS = 20 * 60_000;

export interface SourceFacts {
  /** As said to me: « la ronde de Legion », « la ronde de Cénacle ». */
  readonly label: string;
  readonly path: string;
  /** Older than this, the verdict proves nothing. */
  readonly staleMs: number;
}

export const RONDE_SOURCES: Readonly<Record<RondeSource, SourceFacts>> = {
  legion: { label: "Legion", path: LEGION_VERDICT_PATH, staleMs: LEGION_STALE_MS },
  cenacle: { label: "Cénacle", path: RONDE_VERDICT_PATH, staleMs: CENACLE_STALE_MS },
};

/**
 * The source securite.toml names; null when it names none that exists, or
 * cannot be read — a missing file (null) included: it is versioned, its
 * absence is a broken checkout, never a choice of Legion.
 */
export function parseRondeSource(securiteToml: string | null): RondeSource | null {
  if (securiteToml === null) return null;
  let data: Record<string, unknown>;
  try {
    data = parse(securiteToml) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ronde = data.ronde;
  if (ronde === undefined) return "legion";
  if (typeof ronde !== "object" || ronde === null || Array.isArray(ronde)) return null;
  if (Object.keys(ronde).some((k) => k !== "source")) return null;
  const source = (ronde as { source?: unknown }).source;
  if (source === undefined) return "legion";
  return source === "legion" || source === "cenacle" ? source : null;
}

/**
 * The chosen ronde's verdict as the operator may believe it: null with no
 * source, no file, or older than its own source's limit (Cénacle's 20
 * minutes are tighter than the operator's 35: the most protective wins). An
 * undated verdict is left to the reader, which refuses it.
 */
export function freshSourceVerdict(
  read: (path: string) => string | null,
  source: RondeSource | null,
  nowMs: number,
): string | null {
  if (source === null) return null;
  const raw = read(RONDE_SOURCES[source].path);
  if (raw === null) return null;
  const at = verdictInstant(raw);
  return at !== null && nowMs - at > RONDE_SOURCES[source].staleMs ? null : raw;
}
