/**
 * The rights of a person named on a prospection card (lot D, 13/11). A card
 * holds a mission, never a person on purpose (people-names.ts), but a name
 * can slip through: this finds the cards that hold it, shows them, writes
 * them for the person if asked (access, portability), and erases them on a
 * typed confirmation. The name is asked at the prompt, never an argument.
 * Journaled as counts, never who.
 */
import { UsageError } from "@cenacle/core";
import type { Card } from "@cenacle/journal";

export interface CardsRightsDeps {
  readonly ask: (question: string) => Promise<string>;
  readonly mentioning: (words: string) => Promise<Card[]>;
  readonly erase: (id: number) => Promise<boolean>;
  readonly record: (type: "person.exported" | "person.erased", cards: number) => Promise<void>;
  /** Writes the export for me only, never over a file (flag wx, mode 0600). */
  readonly write: ((text: string) => void) | null;
  readonly log: (line: string) => void;
}

/** What the person can be given: the card in the notice's words, nothing of the agent's. */
export function cardsExport(cards: readonly Card[], now: Date) {
  return {
    exporte_le: now.toISOString(),
    cartes: cards.map((c) => ({
      intitule: c.title,
      entreprise: c.company,
      lieu: c.place,
      note: c.note,
      lien: c.link,
      creee_le: c.createdAt.toISOString(),
    })),
  };
}

export async function cardsRights(deps: CardsRightsDeps, now: Date): Promise<void> {
  const name = (
    await deps.ask("Nom de la personne, tel qu'il serait écrit sur une carte : ")
  ).trim();
  // Three letters at least: a shorter search would match half the board.
  if (name.replace(/\s/g, "").length < 3)
    throw new UsageError("nom trop court : rien n'a été fait");
  const cards = await deps.mentioning(name);
  await deps.record("person.exported", cards.length);
  if (cards.length === 0) {
    deps.log("ℹ aucune carte ne porte ce nom");
    return;
  }
  for (const c of cards) {
    deps.log(`  n°${c.id} · ${c.title} · ${c.company ?? "—"} · ${c.place ?? "—"}`);
  }
  if (deps.write !== null) {
    deps.write(`${JSON.stringify(cardsExport(cards, now), null, 2)}\n`);
    deps.log(`✔ export écrit (lisible par toi seul) : ${cards.length} carte(s)`);
  }
  const confirm = await deps.ask(
    `Effacer ces ${cards.length} carte(s) ? Tape EFFACER, ou Entrée pour les garder : `,
  );
  if (confirm !== "EFFACER") {
    deps.log("ℹ rien n'a été effacé");
    return;
  }
  let erased = 0;
  for (const c of cards) if (await deps.erase(c.id)) erased++;
  await deps.record("person.erased", erased);
  deps.log(`✔ ${erased} carte(s) effacée(s)`);
}
