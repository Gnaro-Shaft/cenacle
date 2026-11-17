/**
 * Asking the agenda's socket (ADR-0042, point 7) — what the bot imports,
 * and all it imports of the agenda: the protocol and node:net, never the
 * reader nor its transport. The answer is checked field by field; an
 * unreachable server, a refusal or a broken answer is an error, never an
 * empty agenda.
 */
import { createConnection } from "node:net";
import {
  type Ask,
  decodeAnswer,
  encodeLine,
  type HoursView,
  MAX_ANSWER,
  MAX_REQUEST,
  type SocketError,
} from "./prise-protocole.ts";

export type {
  Ask,
  DayHours,
  FailureWord,
  HoursView,
} from "./prise-protocole.ts";
export { agendaSocketPath } from "./prise-protocole.ts";

export type HoursErrorCode = SocketError | "unreachable" | "broken" | "timeout";

export class HoursError extends Error {
  readonly code: HoursErrorCode;
  constructor(code: HoursErrorCode) {
    super(`agenda socket: ${code}`);
    this.name = "HoursError";
    this.code = code;
  }
}

/** The server gives each account 90 s, read in parallel: a margin over it. */
export const CLIENT_TIMEOUT_MS = 120_000;

export function askHours(
  path: string,
  ask: Ask,
  options: { readonly timeoutMs?: number } = {},
): Promise<HoursView> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const conn = createConnection(path);
    const finish = (error: HoursError | null, view?: HoursView) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (error !== null) reject(error);
      else resolve(view as HoursView);
    };
    const timer = setTimeout(
      () => finish(new HoursError("timeout")),
      options.timeoutMs ?? CLIENT_TIMEOUT_MS,
    );
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(encodeLine({ ask }, MAX_REQUEST)));
    conn.on("error", (error: NodeJS.ErrnoException) => {
      const unreachable = error.code === "ENOENT" || error.code === "ECONNREFUSED";
      finish(new HoursError(unreachable ? "unreachable" : "broken"));
    });
    conn.on("close", () => finish(new HoursError("broken")));
    conn.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end === -1) {
        if (Buffer.byteLength(buffer) > MAX_ANSWER) finish(new HoursError("broken"));
        return;
      }
      let answer: ReturnType<typeof decodeAnswer>;
      try {
        if (Buffer.byteLength(buffer.slice(0, end)) > MAX_ANSWER) throw new Error("too long");
        answer = decodeAnswer(buffer.slice(0, end));
      } catch {
        finish(new HoursError("broken"));
        return;
      }
      if ("error" in answer) finish(new HoursError(answer.error));
      else finish(null, answer);
    });
  });
}
