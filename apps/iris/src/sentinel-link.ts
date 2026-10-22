/**
 * Whether the Mac's beats reach the sentinel (ADR-0002), journaled so that the
 * page can show it next to the agents. The sentinel itself lives elsewhere and
 * writes nothing here: what the Mac knows is whether its last beat was taken.
 *
 * Journaled under the agent "sentinel": the state at the first beat, then only
 * its changes — once per outage, like a Telegram outage (tick.ts): unreachable,
 * then reached again with how many minutes it lasted. Numbers and booleans only.
 */

export const SENTINEL_AGENT = "sentinel";

export interface SentinelLinkDeps {
  /** One beat; true when the sentinel took it. Never throws (core/heartbeat.ts). */
  readonly beat: () => Promise<boolean>;
  readonly journal: {
    append(e: { agent: string; type: string; payload?: Record<string, unknown> }): Promise<unknown>;
  };
  readonly log: { warn(text: string): void; info(text: string): void };
  readonly now?: () => Date;
}

export function createSentinelLink(deps: SentinelLinkDeps): { beat(): Promise<void> } {
  const now = deps.now ?? (() => new Date());
  let known: boolean | null = null;
  let downSince: Date | null = null;
  const state = (to: "idle" | "error") =>
    deps.journal.append({ agent: SENTINEL_AGENT, type: "state.changed", payload: { to } });

  return {
    async beat() {
      const up = await deps.beat();
      if (known === up) return;
      if (known === null) {
        // The first beat of this run: the state is said once, whatever it is.
        if (!up)
          deps.log.warn(
            "⚠ Sentinelle injoignable : battement non reçu (on réessaie chaque minute)",
          );
        await deps.journal.append({
          agent: SENTINEL_AGENT,
          type: "sentinel.link",
          payload: { up },
        });
      } else if (!up) {
        deps.log.warn("⚠ Sentinelle injoignable : battement non reçu (on réessaie chaque minute)");
        await deps.journal.append({ agent: SENTINEL_AGENT, type: "sentinel.unreachable" });
      } else {
        deps.log.info("✔ Sentinelle de nouveau jointe");
        const minutes =
          downSince === null ? 0 : Math.round((now().getTime() - downSince.getTime()) / 60_000);
        await deps.journal.append({
          agent: SENTINEL_AGENT,
          type: "sentinel.reached",
          payload: { minutes },
        });
      }
      await state(up ? "idle" : "error");
      known = up;
      downSince = up ? null : now();
    },
  };
}
