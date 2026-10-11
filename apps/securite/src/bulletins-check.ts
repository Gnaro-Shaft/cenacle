/**
 * The CERT-FR's bulletins at the round (J6e3, ADR-0025): the list of my
 * software (securite.toml, plus my private additions in securite.local.toml),
 * and the two public feeds, read by the veille's reader (timeout, capped
 * size), once an hour with the network checks. A feed that fails, or that
 * holds no bulletin at all (a changed page), proves nothing: its check could
 * not run, and closes nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readFeeds } from "@cenacle/cto/veille";
import {
  BULLETIN_FEEDS,
  type BulletinKind,
  bulletinCheck,
  bulletinObservations,
  type CheckResult,
  parseBulletinSoftware,
} from "@cenacle/securite";

const FILES = ["securite.toml", "securite.local.toml"] as const;
/** Every dated item of the feed: the window is the bulletins' own (alerts: a year). */
const ALL_HOURS = 20 * 365 * 24;

/** My software, from both files; null when one cannot be read (said as a finding). */
export function loadSoftware(root: string): string[] | null {
  const names = new Set<string>();
  for (const file of FILES) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    try {
      for (const name of parseBulletinSoftware(readFileSync(path, "utf8"))) names.add(name);
    } catch {
      return null;
    }
  }
  return [...names];
}

export interface BulletinDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

export async function bulletinResults(
  software: readonly string[] | null,
  deps: BulletinDeps,
): Promise<CheckResult[]> {
  const kinds: BulletinKind[] = ["alerte", "avis"];
  return Promise.all(
    kinds.map(async (kind): Promise<CheckResult> => {
      const check = bulletinCheck(kind);
      if (software === null) return { check, ran: false };
      const read = await readFeeds(
        [{ nom: check, url: BULLETIN_FEEDS[kind], theme: "actualite" }],
        ALL_HOURS,
        deps,
      );
      if (read.failed.length > 0 || read.items.length === 0) return { check, ran: false };
      return {
        check,
        ran: true,
        observations: bulletinObservations(read.items, kind, software, deps.now()),
      };
    }),
  );
}
