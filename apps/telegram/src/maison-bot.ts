/**
 * `/maison` (ADR-0048): a demand to the house, typed on Telegram — the first
 * line is its title, the following ones its description. The bot only records
 * it, waiting: it is read again, corrected and accepted on the page alone (its
 * signature), and nothing leaves before that. A refusal names the category,
 * never the text; the reply recalls the rule: no client's name, no mail's
 * content — the text passes through Telegram, then goes to a model abroad.
 */
import { LiaisonTexteRefus, validerTexteDemande } from "@cenacle/core";

export interface MaisonAction {
  readonly kind: "maison_deposer";
  readonly chatId: number;
  readonly titre: string;
  readonly description: string;
}

type Reply = { readonly kind: "reply"; readonly chatId: number; readonly text: string };

export const MAISON_RULE =
  "Rappel : ni nom de client ni contenu de mail — le texte passe par Telegram, puis chez un modèle aux États-Unis, par la maison.";
const USAGE =
  "Écris ainsi : /maison Le titre, sur la première ligne\npuis la description sur les lignes suivantes.";

/** The text after the command: a demand to record, or why not (never quoting it). */
export function maisonAction(rest: string, chatId: number): MaisonAction | Reply {
  const reply = (text: string): Reply => ({ kind: "reply", chatId, text });
  const cut = rest.indexOf("\n");
  const titre = cut === -1 ? rest : rest.slice(0, cut);
  const description = cut === -1 ? "" : rest.slice(cut + 1);
  if (titre.trim() === "" || description.trim() === "") return reply(`📝 ${USAGE}`);
  try {
    const t = validerTexteDemande({ titre, description });
    return { kind: "maison_deposer", chatId, titre: t.titre, description: t.description };
  } catch (e) {
    if (e instanceof LiaisonTexteRefus) {
      return reply(`⛔ Demande refusée, rien n'est enregistré : ${e.message}. ${MAISON_RULE}`);
    }
    throw e;
  }
}

export interface MaisonDeps {
  readonly create: (
    t: { titre: string; description: string },
    dossier: string,
  ) => Promise<{ id: number }>;
  /** The first folder of liaison.local.toml, read at each use; null when it cannot be read. */
  readonly dossier: () => string | null;
  readonly reply: (chatId: number, text: string) => Promise<void>;
  readonly log: (line: string) => void;
}

export async function performMaison(action: MaisonAction, deps: MaisonDeps): Promise<void> {
  const dossier = deps.dossier();
  if (dossier === null) {
    await deps.reply(
      action.chatId,
      "🏠 La liaison avec la maison n'est pas configurée (liaison.local.toml) : rien n'est enregistré.",
    );
    return;
  }
  let id: number;
  try {
    id = (await deps.create(action, dossier)).id;
  } catch (e) {
    if (e instanceof LiaisonTexteRefus) {
      await deps.reply(action.chatId, `⛔ Demande refusée, rien n'est enregistré : ${e.message}.`);
      return;
    }
    // Never the error's text: it may quote the database's address.
    deps.log("⚠ /maison reçu mais non enregistré : base injoignable");
    await deps.reply(
      action.chatId,
      "⚠ Demande NON enregistrée : la base est injoignable. Renvoie /maison dans quelques minutes.",
    );
    return;
  }
  await deps.reply(
    action.chatId,
    `📝 Demande n° ${id} enregistrée. Relis-la et accepte-la sur la page, onglet Maison : ` +
      `rien ne part avant. ${MAISON_RULE}`,
  );
}
