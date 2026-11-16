/**
 * The reminders on Telegram (ADR-0041): /rappel, /rappels, /annuler, and the
 * bell. Only my conversation is heard (handler.ts). The text I type goes
 * through Telegram, outside the EU: never a third party's name nor a mail's
 * content — the rule of /cto, said at each reminder set.
 *
 * Ring, then confirm (Legion's ADR-017): a reminder is marked rung only after
 * it was sent; a send that fails leaves it due for the next pass — at worst
 * twice, never lost. The database away: said, never "set" when it was not.
 */
import { RappelError, type RappelStore, validReminderText } from "@cenacle/journal";
import { parseWhen, sayWhen, WHEN_FORMS } from "./rappel-quand.ts";

export type ReminderAction =
  | {
      readonly kind: "rappel_poser";
      readonly chatId: number;
      readonly due: Date;
      readonly text: string;
    }
  | { readonly kind: "rappels_lister"; readonly chatId: number }
  | { readonly kind: "rappel_annuler"; readonly chatId: number; readonly id: number };

type Reply = { readonly kind: "reply"; readonly chatId: number; readonly text: string };

export const RULE = "Jamais de nom de tiers ni de contenu de mail : le texte passe par Telegram.";
const USAGE = `Pose un rappel ainsi : /rappel <quand> <texte> — quand : ${WHEN_FORMS}.`;
/** At most this many in /rappels: Telegram cuts a message at 4 096 characters. */
export const LISTED = 20;
const SHOWN_TEXT = 80;

/** What /rappel, /rappels and /annuler ask for: pure, the time given. */
export function reminderActions(
  command: "/rappel" | "/rappels" | "/annuler",
  rest: string,
  chatId: number,
  now: Date,
): (ReminderAction | Reply)[] {
  const reply = (text: string): Reply => ({ kind: "reply", chatId, text });
  if (command === "/rappels") return [{ kind: "rappels_lister", chatId }];
  if (command === "/annuler") {
    const m = /^(?:n°\s*)?(\d{1,12})$/i.exec(rest.trim());
    const id = m === null ? Number.NaN : Number(m[1]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return [reply("Pour annuler : /annuler 12 (le numéro que donne /rappels).")];
    }
    return [{ kind: "rappel_annuler", chatId, id }];
  }
  if (rest.trim() === "") return [reply(USAGE)];
  const when = parseWhen(rest, now);
  if ("error" in when) return [reply(`⚠ ${when.error}. ${USAGE}`)];
  try {
    return [{ kind: "rappel_poser", chatId, due: when.at, text: validReminderText(when.rest) }];
  } catch (error) {
    if (!(error instanceof RappelError)) throw error;
    return [reply(`⚠ ${error.message}. ${USAGE}`)];
  }
}

export interface ReminderDeps {
  /** Null when the cadre has no rappels_jours: no reminder may be kept without its retention. */
  readonly store: RappelStore | null;
  readonly reply: (chatId: number, text: string) => Promise<void>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
}

export const NOT_SET_UP =
  "🔕 Les rappels sont coupés : [conservation] rappels_jours manque dans le cadre (ADR-0041).";
const short = (text: string) =>
  text.length > SHOWN_TEXT ? `${text.slice(0, SHOWN_TEXT - 1)}…` : text;

async function answer(action: ReminderAction, store: RappelStore, now: Date): Promise<string> {
  if (action.kind === "rappel_poser") {
    const r = await store.add(action.text, action.due);
    return `🔔 Rappel n°${r.id} : ${sayWhen(r.due, now)}.\n« ${r.text} »\n${RULE}`;
  }
  if (action.kind === "rappel_annuler") {
    return (await store.cancel(action.id))
      ? `🗑 Rappel n°${action.id} annulé et effacé.`
      : `Aucun rappel n°${action.id} à venir (déjà sonné, annulé, ou inconnu).`;
  }
  const list = await store.upcoming(LISTED);
  if (list.length === 0) return "Aucun rappel à venir.";
  return [
    `🔔 ${list.length === LISTED ? `Les ${LISTED} prochains` : "Les"} rappels à venir :`,
    ...list.map((r) => `n°${r.id} — ${sayWhen(r.due, now)} — ${short(r.text)}`),
  ].join("\n");
}

/** Carries out a reminder action; never says done when the database said no. */
export async function performReminder(action: ReminderAction, deps: ReminderDeps): Promise<void> {
  if (deps.store === null) {
    await deps.reply(action.chatId, NOT_SET_UP);
    return;
  }
  let text: string;
  try {
    text = await answer(action, deps.store, deps.now());
  } catch (error) {
    if (error instanceof RappelError) {
      text = `⚠ ${error.message}.`;
    } else {
      // Never the database's text: it may quote its address.
      deps.log(`⚠ Rappel : base injoignable (${action.kind})`);
      text =
        action.kind === "rappel_poser"
          ? "⚠ Rappel NON posé : la base est injoignable. Repose-le dans quelques minutes."
          : "⚠ La base est injoignable : réessaie dans quelques minutes.";
    }
  }
  await deps.reply(action.chatId, text);
}

/** A reminder sent late (the Mac asleep) says when it was due. */
const LATE_MS = 2 * 60_000;

export interface RingDeps {
  readonly store: RappelStore;
  /** Throws when the message did not leave. */
  readonly send: (text: string) => Promise<void>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
}

/** One pass of the bell: what is due, sent, then marked rung. */
export async function ringDue(deps: RingDeps): Promise<{ rang: number; failed: number }> {
  const due = await deps.store.due(deps.now(), 20);
  let rang = 0;
  for (const r of due) {
    const now = deps.now();
    const late =
      now.getTime() - r.due.getTime() > LATE_MS ? `\n(prévu ${sayWhen(r.due, now)})` : "";
    try {
      await deps.send(`🔔 Rappel n°${r.id} — ${r.text}${late}`);
    } catch {
      // Telegram away: this one and the rest wait for the next pass, still due.
      deps.log(`⚠ Rappel n°${r.id} non envoyé : il reste dû, nouvel essai à la prochaine minute`);
      return { rang, failed: due.length - rang };
    }
    // Sent: marked rung. Should this fail, it rings again next pass — twice, never lost.
    await deps.store.markRang(r.id, deps.now());
    rang++;
  }
  return { rang, failed: 0 };
}

export interface PurgeDeps {
  readonly store: RappelStore;
  readonly retentionDays: number;
  readonly now: () => Date;
  /** The trace: how many and before when — never which (charter, rule 4). */
  readonly record: (payload: { readonly count: number; readonly before: string }) => Promise<void>;
}

/** Erases the reminders that rang more than the retention ago; never one still due. */
export async function purgeRang(deps: PurgeDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - deps.retentionDays * 86_400_000);
  const count = await deps.store.purge(cutoff);
  if (count > 0) await deps.record({ count, before: cutoff.toISOString() });
  return count;
}
