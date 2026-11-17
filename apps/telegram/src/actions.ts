/**
 * Carries out what the handler decided for one update. A journal write that
 * fails (the database is away) no longer brings the bot down: the update
 * would come back after the restart and bring it down again, every 30 s, for
 * as long as the database is away — /etat included. Instead:
 *   - /stop answers that the stop was NOT recorded, instead of "noted";
 *   - /maintenance answers that the request was NOT recorded (J7c);
 *   - a stranger's message is still refused, its refusal not journaled.
 * An invalid event is our bug, not an outage: it still throws (charter, rule 3).
 */
import type { Ask } from "@cenacle/agenda/prise";
import { InvalidEventError } from "@cenacle/journal";
import type { Action } from "./handler.ts";
import type { ReminderAction } from "./rappels-bot.ts";

export const STOP_NOT_RECORDED =
  "⚠ Arrêt NON enregistré : la base est injoignable, Iris continue. " +
  "Renvoie /stop dans quelques minutes, ou arrête-la sur le Mac : npm run service -- uninstall iris";

export const MAINTENANCE_NOT_RECORDED =
  "⚠ Demande NON enregistrée : la base est injoignable. Renvoie /maintenance dans quelques minutes.";

export const AGENDA_NOT_WIRED = "📅 L'agenda n'est pas branché sur ce bot.";

export interface ActionDeps {
  readonly reply: (chatId: number, text: string) => Promise<void>;
  readonly askCto: (chatId: number, question: string) => void;
  /** The agenda's hours (ADR-0042, P2), asked apart: a reading may take a minute. */
  readonly agenda?: (chatId: number, ask: Ask) => void;
  readonly listFindings?: (chatId: number, id?: number) => Promise<void>;
  /** A reminder set, listed or cancelled (ADR-0041): its own answer, never a false "set". */
  readonly reminder?: (action: ReminderAction) => Promise<void>;
  readonly record: (type: string, payload: Record<string, unknown>) => Promise<void>;
  readonly log: (line: string) => void;
}

export async function perform(actions: readonly Action[], deps: ActionDeps): Promise<void> {
  // The handler follows a stop or a request with its "noted": that reply must not lie.
  let notRecorded: string | null = null;
  for (const action of actions) {
    if (action.kind === "reply") {
      await deps.reply(action.chatId, notRecorded ?? action.text);
      notRecorded = null;
    } else if (action.kind === "ask_cto") {
      deps.askCto(action.chatId, action.question);
    } else if (action.kind === "agenda") {
      if (deps.agenda === undefined) await deps.reply(action.chatId, AGENDA_NOT_WIRED);
      else deps.agenda(action.chatId, action.ask);
    } else if (action.kind === "securite_list") {
      await deps.listFindings?.(action.chatId, action.id);
    } else if (
      action.kind === "rappel_poser" ||
      action.kind === "rappels_lister" ||
      action.kind === "rappel_annuler"
    ) {
      await deps.reminder?.(action);
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
          notRecorded = STOP_NOT_RECORDED;
          deps.log("⚠ /stop reçu mais non enregistré : base injoignable");
        } else if (action.type === "maintenance.demande") {
          notRecorded = MAINTENANCE_NOT_RECORDED;
          deps.log("⚠ /maintenance reçu mais non enregistré : base injoignable");
        } else {
          deps.log("⚠ Message d'un inconnu refusé, mais refus non journalisé : base injoignable");
        }
      }
    }
  }
}
