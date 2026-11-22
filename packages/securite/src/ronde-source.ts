/**
 * Which ronde's verdict Cénacle believes (ADR-0040): `[ronde] source` in
 * securite.toml. Since R4 (Legion stopped on 22/11/2026) there is one, Cénacle's
 * own; the key stays as the guard it always was: absent, misspelled, "legion",
 * or a file that does not parse — no source, no machine judged, and the
 * operator does not act. Nothing is believed that nobody chose.
 */
import { parse } from "smol-toml";
import { RONDE_VERDICT_PATH } from "./ronde-verdict.ts";
import { verdictInstant } from "./servers.ts";

export type RondeSource = "cenacle";

/** Four passes of Cénacle's ronde missed (ADR-0040, point 5). */
export const CENACLE_STALE_MS = 20 * 60_000;

export interface SourceFacts {
  /** As said to me: « la ronde de Cénacle ». */
  readonly label: string;
  readonly path: string;
  /** Older than this, the verdict proves nothing. */
  readonly staleMs: number;
}

export const RONDE_SOURCES: Readonly<Record<RondeSource, SourceFacts>> = {
  cenacle: { label: "Cénacle", path: RONDE_VERDICT_PATH, staleMs: CENACLE_STALE_MS },
};

/**
 * The source securite.toml names; null when it names none that exists, or
 * cannot be read — a missing file (null) included: it is versioned, its
 * absence is a broken checkout, never a choice.
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
  if (typeof ronde !== "object" || ronde === null || Array.isArray(ronde)) return null;
  if (Object.keys(ronde).some((k) => k !== "source")) return null;
  return (ronde as { source?: unknown }).source === "cenacle" ? "cenacle" : null;
}

/**
 * The chosen ronde's verdict as the operator may believe it: null with no
 * source, no file, or older than its limit (20 minutes, tighter than the
 * operator's 35: the most protective wins). An undated verdict is left to the
 * reader, which refuses it.
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
