/**
 * The bot's long-polling loop. A Telegram failure — a network cut, an outage,
 * a slow-down, a refused token — is waited out, then retried: one line per
 * outage, one line when Telegram is back. Anything else is unexpected and
 * still throws (charter, rule 3): launchd restarts the bot (ADR-0018).
 */
import { TelegramError, type TelegramUpdate } from "./api.ts";
import { retryDelayMs } from "./backoff.ts";

export interface PollDeps {
  readonly getUpdates: (offset: number) => Promise<TelegramUpdate[]>;
  /** Handles one update; its own failures are its business. */
  readonly handle: (update: TelegramUpdate) => Promise<void>;
  readonly stopped: () => boolean;
  /** Waits, and returns early when stopped. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly random?: () => number;
}

export async function poll(deps: PollDeps): Promise<void> {
  let offset = 0;
  let attempt = 0;
  while (!deps.stopped()) {
    let updates: TelegramUpdate[];
    try {
      updates = await deps.getUpdates(offset);
    } catch (error) {
      if (!(error instanceof TelegramError)) throw error;
      attempt++;
      const ms = retryDelayMs(error, attempt, deps.random);
      if (attempt === 1) {
        deps.log(
          error.kind === "unauthorized"
            ? `🛑 Telegram refuse le jeton du bot : nouvel essai toutes les ${Math.round(ms / 60_000)} min (vérifie TELEGRAM_BOT_TOKEN)`
            : `⚠ Telegram injoignable (${error.kind}) : nouvel essai dans ${Math.round(ms / 1000)} s`,
        );
      }
      await deps.sleep(ms);
      continue;
    }
    if (attempt > 0) {
      deps.log(`✔ Telegram de nouveau joint, après ${attempt} essai(s)`);
      attempt = 0;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      await deps.handle(update);
    }
  }
}
