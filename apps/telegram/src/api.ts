/**
 * Minimal Telegram Bot API client (long polling): no dependency, no webhook,
 * no open port. The token is a secret: it never appears in an error message.
 */

export interface TelegramMessage {
  readonly message_id: number;
  readonly chat: { readonly id: number; readonly type: string };
  readonly from?: { readonly id: number };
  readonly text?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
}

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

export interface TelegramApi {
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
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
      throw new TelegramError(redact(`Telegram unreachable (${method}): ${String(error)}`));
    }
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (!response.ok || data?.ok !== true) {
      throw new TelegramError(
        redact(
          `Telegram ${method} failed (${response.status}): ${data?.description ?? "no details"}`,
        ),
      );
    }
    return data.result as T;
  }

  return {
    getUpdates: (offset, timeoutSeconds) =>
      call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message"] }),
    async sendMessage(chatId, text) {
      await call("sendMessage", { chat_id: chatId, text });
    },
  };
}
