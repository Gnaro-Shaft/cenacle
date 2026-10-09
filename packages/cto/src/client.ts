/**
 * Asking the CTO's service over its local socket (ADR-0020): used by the
 * page's server and by `npm run cto`. Every line from the service is checked;
 * an unreachable service, a refusal or a broken answer is an error, never an
 * empty reply.
 */
import { createConnection } from "node:net";
import type { CtoProgress, CtoReply } from "./pipeline.ts";
import { decodeEvent, type ErrorCode, encode, MAX_LINE } from "./protocol.ts";

export class CtoServiceError extends Error {
  readonly code: ErrorCode | "unreachable" | "broken" | "timeout";
  constructor(code: CtoServiceError["code"], message: string) {
    super(message);
    this.name = "CtoServiceError";
    this.code = code;
  }
}

/** Two model calls of 5 min at most, plus a wait in line. */
export const CLIENT_TIMEOUT_MS = 20 * 60_000;

export function askCtoService(
  path: string,
  question: string,
  options: { readonly onProgress?: (p: CtoProgress) => void; readonly timeoutMs?: number } = {},
): Promise<CtoReply> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const conn = createConnection(path);
    const finish = (error: CtoServiceError | null, reply?: CtoReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (error !== null) reject(error);
      else resolve(reply as CtoReply);
    };
    const timer = setTimeout(
      () => finish(new CtoServiceError("timeout", "le CTO n'a pas répondu à temps")),
      options.timeoutMs ?? CLIENT_TIMEOUT_MS,
    );
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(encode({ question })));
    conn.on("error", (error: NodeJS.ErrnoException) => {
      const unreachable = error.code === "ENOENT" || error.code === "ECONNREFUSED";
      finish(
        new CtoServiceError(
          unreachable ? "unreachable" : "broken",
          unreachable ? "le service du CTO ne tourne pas" : "liaison avec le CTO rompue",
        ),
      );
    });
    conn.on("close", () =>
      finish(new CtoServiceError("broken", "le CTO a fermé la liaison sans répondre")),
    );
    conn.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE * 4) {
        finish(new CtoServiceError("broken", "réponse du CTO trop longue"));
        return;
      }
      for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let event: ReturnType<typeof decodeEvent>;
        try {
          event = decodeEvent(line);
        } catch {
          finish(new CtoServiceError("broken", "réponse du CTO malformée"));
          return;
        }
        if (event.event === "progress") {
          try {
            options.onProgress?.(event.progress);
          } catch {
            // Progress is display only.
          }
        } else if (event.event === "error") {
          finish(new CtoServiceError(event.code, event.message));
          return;
        } else {
          finish(null, event.reply);
          return;
        }
      }
    });
  });
}
