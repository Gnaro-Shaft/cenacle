/**
 * One minute of the reminders' bell (ADR-0041), and its heartbeat to the
 * sentinel (ADR-0002). The bot beats only after a pass that went to its end:
 * a bot stopped, or a bell failing at every pass, falls silent, and the
 * sentinel says so — a reminder that does not ring is never silent.
 *
 * Reminders switched off (no retention in the cadre): nothing to ring, the
 * bot still beats — it is alive, and said at its start why nothing rings.
 * A beat says "bot" and the time, nothing else (core/heartbeat.ts).
 */
import type { Heartbeat } from "@cenacle/core";
import { InvalidEventError } from "@cenacle/journal";

/**
 * The sentinel, for the bell. Misconfigured (a token missing or short, an
 * address malformed): said, and the bot runs without it — the reminders still
 * ring, and the sentinel, no longer hearing the bell, says so itself.
 */
export function bellHeartbeat(
  make: () => Heartbeat | null,
  log: (line: string) => void,
): Heartbeat | null {
  try {
    const heartbeat = make();
    if (heartbeat === null) {
      log("ℹ Sentinelle non configurée (CENACLE_SENTINEL_URL absent) : aucun battement envoyé.");
    }
    return heartbeat;
  } catch (error) {
    // Our own message: variable names, never a value (core/heartbeat.ts).
    const why = error instanceof Error ? error.message : "inconnu";
    log(
      `⚠ Sentinelle mal configurée (${why}) : aucun battement, les rappels sonnent ; la sentinelle, qui n'entend plus la cloche, le dira.`,
    );
    return null;
  }
}

export interface BellBeat {
  /** Sends one beat; says a beat not taken once, and its return once. */
  afterPass(): Promise<void>;
}

export function createBellBeat(deps: {
  /** One beat; true when the sentinel took it. Never throws (core/heartbeat.ts). */
  readonly beat: () => Promise<boolean>;
  readonly log: (line: string) => void;
}): BellBeat {
  let taken: boolean | null = null;
  return {
    async afterPass() {
      const ok = await deps.beat();
      if (ok === taken) return;
      if (!ok) {
        deps.log(
          "⚠ La sentinelle n'a pas pris le battement du bot (injoignable, ou pas encore à jour) : les rappels, eux, sonnent.",
        );
      } else if (taken === false) {
        deps.log("✔ La sentinelle reprend le battement du bot.");
      }
      taken = ok;
    },
  };
}

export interface BellMinuteDeps {
  /** Ringing what is due, and the purge; null when the reminders are off. */
  readonly pass: (() => Promise<void>) | null;
  /** Null when no sentinel is configured. */
  readonly beat: BellBeat | null;
  readonly log: (line: string) => void;
}

/** The pass, then — only when it went to its end — the beat. True when it did. */
export async function bellMinute(deps: BellMinuteDeps): Promise<boolean> {
  if (deps.pass !== null) {
    try {
      await deps.pass();
    } catch (error) {
      // A journal entry the code itself got wrong is a bug: it stops the bot.
      if (error instanceof InvalidEventError) throw error;
      // Its name only: the database's text may quote its address.
      const name = error instanceof Error ? error.name : "inconnu";
      deps.log(`⚠ Rappels : passage manqué (${name}), nouvel essai dans une minute`);
      return false;
    }
  }
  await deps.beat?.afterPass();
  return true;
}
