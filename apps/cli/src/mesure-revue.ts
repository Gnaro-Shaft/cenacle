/**
 * The review of the sorting measure (mesure:rangement): what my answer means,
 * and what the replay changed. Pure — no mailbox, no base.
 *
 * With --simuler, two decisions are shown; Enter means "right" only when they
 * agree. When they differ, I must type the box: Enter would pick one for me.
 */
import type { Category } from "@cenacle/core";

export const ANSWER_KEYS: Readonly<Record<string, Category>> = {
  c: "clients_prospects",
  a: "administratif",
  b: "bruit",
  m: "missions",
  t: "a_trier",
};

/** "again": the answer says nothing usable, ask once more. */
export type Answer = Category | "quit" | "again";

export function readAnswer(raw: string, iris: Category, replayed?: Category): Answer {
  const answer = raw.trim().toLowerCase();
  if (answer === "q") return "quit";
  if (answer === "") return replayed === undefined || replayed === iris ? iris : "again";
  return Object.hasOwn(ANSWER_KEYS, answer) ? (ANSWER_KEYS[answer] as Category) : "again";
}

export interface Judged {
  readonly iris: Category;
  readonly replayed: Category;
  readonly truth: Category;
}

export interface Changes {
  /** The replay decides another box than Iris did. */
  readonly changed: number;
  /** …and it is right where Iris was wrong. */
  readonly better: number;
  /** …and it is wrong where Iris was right. */
  readonly worse: number;
}

export function changesOf(judged: readonly Judged[]): Changes {
  let changed = 0;
  let better = 0;
  let worse = 0;
  for (const { iris, replayed, truth } of judged) {
    if (iris === replayed) continue;
    changed++;
    if (replayed === truth) better++;
    else if (iris === truth) worse++;
  }
  return { changed, better, worse };
}
