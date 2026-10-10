/**
 * The security agent's buttons, on the bot's side (J6b, ADR-0025). Only the
 * owner, in the private chat, is heard; anyone else is ignored and journaled
 * without who. A tap is read strictly and decided by the database with the
 * finding's single-use token; the decision is written before any answer, so
 * a failed edit of the message loses nothing. Keeping a risk asks for a
 * reason, taken only as a direct reply to that question, within 10 minutes.
 * No AI decides anything here.
 */
import type { Journal, SecuriteDecisions, SecuriteStore } from "@cenacle/journal";
import { ANSWER, keyboard, parsePressed, SEVERITY_LABEL, withoutFinding } from "@cenacle/securite";
import type { InlineButton, TelegramApi, TelegramCallback, TelegramMessage } from "./api.ts";

const REASON_DEADLINE_MS = 10 * 60_000;
const AGENT = "securite";

export interface SecuriteBotDeps {
  readonly allowedChatId: number;
  readonly api: Pick<
    TelegramApi,
    "sendMessage" | "sendWithButtons" | "askReply" | "answerCallback" | "editButtons"
  >;
  readonly store: Pick<SecuriteStore, "open">;
  readonly decisions: SecuriteDecisions;
  readonly journal: Pick<Journal, "append">;
  readonly now: () => Date;
}

const toInline = (rows: readonly { text: string; data: string }[][]): InlineButton[][] =>
  rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));
const fromInline = (rows: readonly (readonly InlineButton[])[] | undefined) =>
  (rows ?? []).map((row) => row.map((b) => ({ text: b.text, data: b.callback_data })));

const decided = (deps: SecuriteBotDeps, action: string) =>
  deps.journal.append({ agent: AGENT, type: "securite.decided", payload: { action } });

/** /constats: every finding still to fix, with its buttons. */
export async function listFindings(chatId: number, deps: SecuriteBotDeps): Promise<void> {
  const open = await deps.store.open();
  if (open.length === 0) {
    await deps.api.sendMessage(chatId, "🛡 Aucun constat ouvert.");
    return;
  }
  const lines = open.map(
    (f) =>
      `n°${f.id} · ${SEVERITY_LABEL[f.severity]} · ${f.title}${f.status === "pris_en_charge" ? " (pris en charge)" : ""}`,
  );
  const tokens = await deps.decisions.tokens(open.map((f) => f.id));
  const rows = keyboard(
    open.flatMap((f) => (tokens.has(f.id) ? [{ id: f.id, token: tokens.get(f.id) ?? "" }] : [])),
  );
  await deps.api.sendWithButtons(
    chatId,
    `🛡 Constats à traiter :\n${lines.join("\n")}`.slice(0, 4000),
    toInline(rows),
  );
}

export async function handleCallback(cb: TelegramCallback, deps: SecuriteBotDeps): Promise<void> {
  const chat = cb.message?.chat;
  if (
    cb.from.id !== deps.allowedChatId ||
    chat?.id !== deps.allowedChatId ||
    chat.type !== "private"
  ) {
    await deps.journal.append({
      agent: "cenacle",
      type: "telegram.rejected",
      payload: { reason: "not_the_owner" },
    });
    return;
  }
  const pressed = parsePressed(cb.data);
  if (pressed === null) {
    await deps.api.answerCallback(cb.id, ANSWER.stale);
    return;
  }
  const now = deps.now();
  if (pressed.action === "keep") {
    const state = await deps.decisions.check(pressed.id, pressed.token);
    if (state !== "done") {
      await deps.api.answerCallback(cb.id, ANSWER[state]);
      return;
    }
    const prompt = await deps.api.askReply(chat.id, ANSWER.askReason(pressed.id));
    await deps.decisions.askReason(
      prompt,
      pressed.id,
      new Date(now.getTime() + REASON_DEADLINE_MS),
    );
    await deps.api.answerCallback(cb.id, "☑ J'attends la raison.");
    return;
  }
  const outcome = await deps.decisions.decide(pressed.id, pressed.token, pressed.action, now);
  if (outcome !== "done") {
    await deps.api.answerCallback(cb.id, ANSWER[outcome]);
    return;
  }
  await decided(deps, pressed.action);
  // Written already: what follows only tidies the message, and may fail.
  try {
    await deps.api.answerCallback(cb.id, ANSWER[pressed.action](pressed.id));
    const message = cb.message;
    if (message !== undefined) {
      const left = withoutFinding(fromInline(message.reply_markup?.inline_keyboard), pressed.id);
      await deps.api.editButtons(chat.id, message.message_id, toInline(left));
    }
  } catch {
    // The decision stands; the buttons of an old message are refused by their token.
  }
}

/** A reply to the bot's question for a reason: true when it was one (handled). */
export async function handleReasonReply(
  message: TelegramMessage,
  deps: SecuriteBotDeps,
): Promise<boolean> {
  const promptId = message.reply_to_message?.message_id;
  if (promptId === undefined) return false;
  if (
    message.chat.id !== deps.allowedChatId ||
    message.from?.id !== deps.allowedChatId ||
    message.chat.type !== "private"
  ) {
    return false;
  }
  const now = deps.now();
  if (!(await deps.decisions.isAsking(promptId, now))) return false;
  const text = (message.text ?? "").trim();
  if (text === "/annuler") {
    await deps.api.sendMessage(message.chat.id, ANSWER.cancelled);
    return true;
  }
  const reason = text.replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) {
    await deps.api.sendMessage(message.chat.id, ANSWER.badReason);
    return true;
  }
  const outcome = await deps.decisions.giveReason(promptId, reason, now);
  if (outcome === "done") await decided(deps, "keep");
  await deps.api.sendMessage(message.chat.id, outcome === "done" ? ANSWER.kept : ANSWER[outcome]);
  return true;
}
