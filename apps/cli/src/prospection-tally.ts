/**
 * What the prospection survey shows (npm run prospection:releve): for each
 * platform word, how many of its mails were read, their exact sender
 * addresses, and the hosts their links point to — what prospection.local.toml
 * and the [missions] rule need. Never a subject, a text or a whole link: a
 * link's path and query may carry tracking, and my identity.
 */
import { senderOfSource } from "@cenacle/mail";
import { bodyOf } from "@cenacle/prospection";

export interface PlatformTally {
  readonly mails: number;
  /** Exact sender address → mails. */
  readonly senders: ReadonlyMap<string, number>;
  /** Link host → mails that hold at least one link to it. */
  readonly hosts: ReadonlyMap<string, number>;
}

export const WORD_RULE = /^[a-z0-9][a-z0-9.-]{1,39}$/;
export const DEFAULT_WORDS = ["linkedin", "free-work", "malt", "collective"];
const MAX_DAYS = 366;

/** `[--jours n] [mot …]`, in any order: the days and the words, or what is wrong. */
export function surveyArgs(args: readonly string[]): { days: number; words: string[] } | string {
  const at = args.indexOf("--jours");
  const days = at === -1 ? 60 : Number(args[at + 1]);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return `--jours attend un entier de 1 à ${MAX_DAYS}`;
  }
  const given = args.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
  const words = given.length === 0 ? DEFAULT_WORDS : given.map((w) => w.toLowerCase());
  const bad = words.find((w) => !WORD_RULE.test(w));
  return bad === undefined ? { days, words } : `mot invalide : ${bad}`;
}

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

/**
 * A mail counts for a word only when its sender's DOMAIN holds the word: the
 * server's FROM search also matches a display name, which anyone writes.
 */
export async function tallyPlatforms(
  sources: readonly Buffer[],
  words: readonly string[],
): Promise<Map<string, PlatformTally>> {
  const out = new Map<
    string,
    { mails: number; senders: Map<string, number>; hosts: Map<string, number> }
  >(words.map((w) => [w, { mails: 0, senders: new Map(), hosts: new Map() }]));
  const seen = new Set<string>();
  for (const source of sources) {
    const address = senderOfSource(source);
    const domain = address?.split("@")[1];
    if (address === null || domain === undefined) continue;
    const word = words.find((w) => domain === w || domain.endsWith(`.${w}`) || domain.includes(w));
    if (word === undefined) continue;
    // The same mail met in two folders (a copy) counts once.
    const id = `${address}|${source.length}|${source.subarray(0, 2048).toString("latin1")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = out.get(word);
    if (t === undefined) continue;
    t.mails++;
    bump(t.senders, address);
    const hosts = new Set<string>();
    for (const link of (await bodyOf(source, 1_000_000)).links) {
      try {
        hosts.add(new URL(link).hostname);
      } catch {
        // an address the URL parser refuses is not a host to declare
      }
    }
    for (const h of hosts) bump(t.hosts, h);
  }
  return out;
}

/** Most frequent first, then alphabetical: the alert address and the main hosts on top. */
export function ranked(m: ReadonlyMap<string, number>): [string, number][] {
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
