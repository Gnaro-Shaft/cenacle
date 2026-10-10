/**
 * How long the bot waits before calling Telegram again (pure). A network cut
 * or a Telegram outage: 2, 4, 8… s up to a minute, with some jitter so as not
 * to knock at fixed intervals. Slowed down: as long as Telegram asks, five
 * minutes at most. A refused token: five minutes — retrying fast cannot help.
 */
import type { TelegramFailure } from "./api.ts";

export const MAX_NETWORK_DELAY_MS = 60_000;
export const MAX_RATE_LIMIT_DELAY_MS = 300_000;
export const UNAUTHORIZED_DELAY_MS = 300_000;
const FIRST_DELAY_MS = 2_000;

export function retryDelayMs(
  failure: { readonly kind: TelegramFailure; readonly retryAfterSeconds?: number | undefined },
  attempt: number,
  random: () => number = Math.random,
): number {
  if (failure.kind === "unauthorized") return UNAUTHORIZED_DELAY_MS;
  if (failure.kind === "rate_limited") {
    const asked = (failure.retryAfterSeconds ?? 5) * 1000;
    return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(1000, asked));
  }
  const base = Math.min(MAX_NETWORK_DELAY_MS, FIRST_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  // ±20 %, never past the cap.
  return Math.min(MAX_NETWORK_DELAY_MS, Math.round(base * (0.8 + 0.4 * random())));
}

/** Waits `ms`, but stops at once when `stopped()` turns true (a stop stays immediate). */
export async function sleepUnless(ms: number, stopped: () => boolean, tickMs = 250): Promise<void> {
  const end = Date.now() + ms;
  while (!stopped() && Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(tickMs, end - Date.now())));
  }
}
