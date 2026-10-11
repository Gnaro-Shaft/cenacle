/**
 * The buttons of an action on a server, on the bot's side (J6f1b, ADR-0027).
 * 🔁 under a server finding makes a request — only with the finding's token,
 * only for a finding of the kind that action answers, only when the switch
 * is on — and asks me to confirm; ✅ Confirmer, within 60 seconds, makes it
 * runnable. The bot holds no key and runs nothing: the operator, alone,
 * acts within the minute. Both taps are written before any answer.
 */
import type { SecuriteDecisions, SecuriteStore, ServeurActions } from "@cenacle/journal";
import { ANSWER, opKeyboard, SERVER_CATALOGUE } from "@cenacle/securite";
import type { InlineButton, TelegramApi, TelegramCallback } from "./api.ts";

export interface ServerBotDeps {
  readonly api: Pick<TelegramApi, "sendWithButtons" | "answerCallback" | "editButtons">;
  readonly store: Pick<SecuriteStore, "open">;
  readonly decisions: Pick<SecuriteDecisions, "check">;
  readonly serverActions: Pick<ServeurActions, "request" | "confirm">;
  /** `[serveurs] actif` of securite.toml, read at each tap. */
  readonly serversActive: () => boolean;
  readonly decided: (action: string) => Promise<unknown>;
  readonly now: () => Date;
}

const inline = (rows: readonly { text: string; data: string }[][]): InlineButton[][] =>
  rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));

/** 🔁 under a finding: a request waiting for my confirmation. */
export async function pressServer(
  cb: TelegramCallback,
  chatId: number,
  pressed: { id: number; token: string },
  deps: ServerBotDeps,
): Promise<void> {
  if (!deps.serversActive()) {
    await deps.api.answerCallback(cb.id, ANSWER.serverOff);
    return;
  }
  const state = await deps.decisions.check(pressed.id, pressed.token);
  if (state !== "done") {
    await deps.api.answerCallback(cb.id, ANSWER[state]);
    return;
  }
  const finding = (await deps.store.open()).find((f) => f.id === pressed.id);
  if (finding === undefined || finding.type !== SERVER_CATALOGUE.services.finding) {
    await deps.api.answerCallback(cb.id, ANSWER.notServer);
    return;
  }
  const request = await deps.serverActions.request(
    finding.id,
    finding.target,
    "services",
    deps.now(),
  );
  if (request === null) {
    await deps.api.answerCallback(cb.id, ANSWER.serverPending);
    return;
  }
  await deps.decided("server_request");
  await deps.api.sendWithButtons(
    chatId,
    ANSWER.serverAsk(finding.target, finding.id),
    inline(opKeyboard(request.id, request.token)),
  );
  await deps.api.answerCallback(cb.id, ANSWER.server(finding.id));
}

/** ✅ Confirmer: within its 60 seconds, once. The button goes either way. */
export async function confirmServer(
  cb: TelegramCallback,
  chatId: number,
  op: { id: number; token: string },
  deps: ServerBotDeps,
): Promise<void> {
  const outcome = await deps.serverActions.confirm(op.id, op.token, deps.now());
  if (outcome === "done") await deps.decided("server_confirm");
  await deps.api.answerCallback(
    cb.id,
    outcome === "done"
      ? ANSWER.serverConfirmed
      : outcome === "expired"
        ? ANSWER.serverExpired
        : outcome === "already"
          ? ANSWER.serverAlready
          : ANSWER.stale,
  );
  if (outcome === "done" || outcome === "expired") {
    // Written already: removing the button only tidies the message, and may fail.
    const message = cb.message;
    if (message !== undefined) {
      await deps.api.editButtons(chatId, message.message_id, []).catch(() => undefined);
    }
  }
}
