/**
 * Minimal Telegram Bot API client (long polling): no dependency, no webhook,
 * no open port. The token is a secret: it never appears in an error message.
 */

export interface TelegramMessage {
  readonly message_id: number;
  readonly chat: { readonly id: number; readonly type: string };
  readonly from?: { readonly id: number };
  readonly text?: string;
  /** The message this one answers (a reason given to the bot's question, J6b). */
  readonly reply_to_message?: { readonly message_id: number };
}

export interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

/** A tap on a button under one of the bot's messages (J6b). */
export interface TelegramCallback {
  readonly id: string;
  readonly from: { readonly id: number };
  readonly message?: {
    readonly message_id: number;
    readonly chat: { readonly id: number; readonly type: string };
    readonly reply_markup?: { readonly inline_keyboard?: readonly (readonly InlineButton[])[] };
  };
  readonly data?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: TelegramCallback;
}

/**
 * Why a call failed, for the bot to know what to do: wait a little (network,
 * or Telegram down), wait as long as Telegram asks (rate_limited), wait long
 * (unauthorized: retrying fast cannot help), or give up on this request.
 */
export type TelegramFailure = "network" | "rate_limited" | "unauthorized" | "rejected";

export class TelegramError extends Error {
  readonly kind: TelegramFailure;
  /** What Telegram asks to wait before the next call (429 only). */
  readonly retryAfterSeconds: number | undefined;
  constructor(message: string, kind: TelegramFailure = "rejected", retryAfterSeconds?: number) {
    super(message);
    this.name = "TelegramError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A response's failure kind: 401/403 refused, 429 slowed down, 5xx down, anything else rejected. */
function failureOf(status: number): TelegramFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "network";
  return "rejected";
}

export interface TelegramApi {
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
  /** A message with buttons under it; returns its id. */
  sendWithButtons(
    chatId: number,
    text: string,
    rows: readonly (readonly InlineButton[])[],
  ): Promise<number>;
  /** A question the answer to which must be a reply to it; returns its id. */
  askReply(chatId: number, text: string): Promise<number>;
  /** Tells Telegram the tap was heard, with a short note shown to me. */
  answerCallback(callbackId: string, text: string): Promise<void>;
  /** Replaces the buttons under a message (none: removed). */
  editButtons(
    chatId: number,
    messageId: number,
    rows: readonly (readonly InlineButton[])[],
  ): Promise<void>;
}

const TOKEN_RULE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

export function createTelegramApi(token: string, fetchFn: typeof fetch = fetch): TelegramApi {
  if (!TOKEN_RULE.test(token)) {
    throw new TelegramError("TELEGRAM_BOT_TOKEN is missing or malformed (expected digits:secret)");
  }
  const redact = (text: string) => text.split(token).join("<token>");

  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new TelegramError(
        redact(`Telegram unreachable (${method}): ${String(error)}`),
        "network",
      );
    }
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: unknown };
    } | null;
    if (!response.ok || data?.ok !== true) {
      const retryAfter = data?.parameters?.retry_after;
      throw new TelegramError(
        redact(
          `Telegram ${method} failed (${response.status}): ${data?.description ?? "no details"}`,
        ),
        response.ok ? "rejected" : failureOf(response.status),
        typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return data.result as T;
  }

  return {
    getUpdates: (offset, timeoutSeconds) =>
      call("getUpdates", {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      }),
    async sendMessage(chatId, text) {
      await call("sendMessage", { chat_id: chatId, text });
    },
    async sendWithButtons(chatId, text, rows) {
      const sent = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: rows },
      });
      return sent.message_id;
    },
    async askReply(chatId, text) {
      const sent = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: { force_reply: true, selective: true },
      });
      return sent.message_id;
    },
    async answerCallback(callbackId, text) {
      await call("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: text.slice(0, 190),
      });
    },
    async editButtons(chatId, messageId, rows) {
      await call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
    },
  };
}
