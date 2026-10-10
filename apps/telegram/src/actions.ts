/**
 * Carries out what the handler decided for one update. A journal write that
 * fails (the database is away) no longer brings the bot down: the update
 * would come back after the restart and bring it down again, every 30 s, for
 * as long as the database is away — /etat included. Instead:
 *   - /stop answers that the stop was NOT recorded, instead of "noted";
 *   - a stranger's message is still refused, its refusal not journaled.
 * An invalid event is our bug, not an outage: it still throws (charter, rule 3).
 */
import { InvalidEventError } from "@cenacle/journal";
import type { Action } from "./handler.ts";

export const STOP_NOT_RECORDED =
  "⚠ Arrêt NON enregistré : la base est injoignable, Iris continue. " +
  "Renvoie /stop dans quelques minutes, ou arrête-la sur le Mac : npm run service -- uninstall iris";

export interface ActionDeps {
  readonly reply: (chatId: number, text: string) => Promise<void>;
  readonly askCto: (chatId: number, question: string) => void;
  readonly record: (type: string, payload: Record<string, unknown>) => Promise<void>;
  readonly log: (line: string) => void;
}

export async function perform(actions: readonly Action[], deps: ActionDeps): Promise<void> {
  // The handler follows the stop with its "noted": that reply must not lie.
  let stopNotRecorded = false;
  for (const action of actions) {
    if (action.kind === "reply") {
      await deps.reply(action.chatId, stopNotRecorded ? STOP_NOT_RECORDED : action.text);
      stopNotRecorded = false;
    } else if (action.kind === "ask_cto") {
      deps.askCto(action.chatId, action.question);
    } else {
      try {
        await deps.record(
          action.type,
          action.type === "telegram.rejected" ? { reason: action.reason } : {},
        );
      } catch (error) {
        if (error instanceof InvalidEventError) throw error;
        // Never the error's text: it may quote the database's address.
        if (action.type === "stop.requested") {
          stopNotRecorded = true;
          deps.log("⚠ /stop reçu mais non enregistré : base injoignable");
        } else {
          deps.log("⚠ Message d'un inconnu refusé, mais refus non journalisé : base injoignable");
        }
      }
    }
  }
}
