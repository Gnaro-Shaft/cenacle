/**
 * The Mac's heartbeat to the sentinel (phase 5, S2 — ADR-0002). The Mac
 * speaks, the sentinel listens; nothing comes back but a status code. A beat
 * says which program is alive and when — never anything else.
 * Not configured (no CENACLE_SENTINEL_URL): no heartbeat, said at start by
 * the caller. Configured without its token: an error, not a silent skip.
 */

export const SENTINEL_URL_VAR = "CENACLE_SENTINEL_URL";
export const SENTINEL_TOKEN_VAR = "CENACLE_SENTINEL_TOKEN";

export interface Heartbeat {
  /** Sends one beat. True when the sentinel took it. Never throws. */
  beat(): Promise<boolean>;
}

export function createHeartbeat(opts: {
  readonly url: string;
  readonly token: string;
  readonly program: "iris" | "executor";
  readonly now?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}): Heartbeat {
  const send = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => new Date());
  return {
    async beat() {
      try {
        const response = await send(opts.url, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
          body: JSON.stringify({ program: opts.program, at: now().toISOString() }),
          signal: AbortSignal.timeout(5000),
        });
        return response.status === 204;
      } catch {
        return false;
      }
    },
  };
}

export function heartbeatFromEnv(
  program: "iris" | "executor",
  env: NodeJS.ProcessEnv = process.env,
): Heartbeat | null {
  const url = env[SENTINEL_URL_VAR] ?? "";
  if (url === "") return null;
  if (!/^https?:\/\/[^\s/]+\/battement$/.test(url)) {
    throw new Error(`${SENTINEL_URL_VAR} must look like http://<sentinel>:<port>/battement`);
  }
  const token = env[SENTINEL_TOKEN_VAR] ?? "";
  if (token.length < 32) {
    throw new Error(`${SENTINEL_TOKEN_VAR} is missing or too short (.env.sentinel)`);
  }
  return createHeartbeat({ url, token, program });
}
