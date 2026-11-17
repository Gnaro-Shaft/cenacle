/**
 * The agenda's local socket (ADR-0042, point 7), opened by the page's server:
 * the bot asks it for tomorrow's or the week's hours. Only my account can
 * open it (0600, in a 0700 folder) — no network port. Its bounds: one reading
 * at a time (a second asker is told "busy"), a request of one short line
 * within a few seconds, an answer of the closed schema, which holds no title.
 * Nothing is kept: the answer lives for the time of the connection.
 */
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { hoursOf } from "./heures.ts";
import type { AgendaView } from "./lecture.ts";
import {
  type Ask,
  decodeAsk,
  encodeLine,
  MAX_ANSWER,
  MAX_REQUEST,
  type SocketAnswer,
} from "./prise-protocole.ts";
import { addDays, isoDate } from "./times.ts";

/** A caller that does not send its request within this delay is dropped. */
export const REQUEST_TIMEOUT_MS = 5000;

/** The answer to one request, one reading at a time. */
export function createHoursService(
  read: (days: number) => Promise<AgendaView>,
): (ask: Ask) => Promise<SocketAnswer> {
  let running = false;
  return async (ask) => {
    if (running) return { error: "busy" };
    running = true;
    try {
      // Tomorrow is read with today, the window always starting today.
      const view = await read(ask === "tomorrow" ? 2 : 7);
      if (view.read !== "ok") return hoursOf(view, "", 1);
      const [y = 0, m = 1, d = 1] = view.from.split("-").map(Number);
      return ask === "tomorrow"
        ? hoursOf(view, isoDate(addDays({ y, m, d }, 1)), 1)
        : hoursOf(view, view.from, 7);
    } catch {
      // A fault of ours: one word, never its message.
      return { error: "internal" };
    } finally {
      running = false;
    }
  };
}

/** Listens on the socket; refuses to replace anything that is not a stale socket. */
export async function listenHours(
  path: string,
  answer: (ask: Ask) => Promise<SocketAnswer>,
  options: { readonly requestTimeoutMs?: number } = {},
): Promise<{ close(): Promise<void> }> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  try {
    if (!lstatSync(path).isSocket()) throw new Error(`${path} exists and is not a socket`);
    // A stale socket from a killed server: the instance lock says it is ours.
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const open = new Set<Socket>();
  const server: Server = createServer((conn) => {
    open.add(conn);
    conn.setEncoding("utf8");
    let buffer = "";
    let asked = false;
    const say = (message: SocketAnswer) => {
      try {
        conn.end(encodeLine(message, MAX_ANSWER));
      } catch {
        conn.end(encodeLine({ error: "internal" }, MAX_ANSWER));
      }
    };
    const timer = setTimeout(() => {
      if (!asked) conn.destroy();
    }, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    conn.on("close", () => {
      open.delete(conn);
      clearTimeout(timer);
    });
    conn.on("error", () => {});
    conn.on("data", (chunk: string) => {
      if (asked) return;
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end === -1 && Buffer.byteLength(buffer) <= MAX_REQUEST) return;
      asked = true;
      clearTimeout(timer);
      let ask: Ask;
      try {
        if (end === -1 || Buffer.byteLength(buffer.slice(0, end)) > MAX_REQUEST) {
          throw new Error("request too long");
        }
        ask = decodeAsk(buffer.slice(0, end));
      } catch {
        say({ error: "invalid" });
        return;
      }
      void answer(ask).then(
        (message) => {
          if (!conn.destroyed) say(message);
        },
        () => {
          if (!conn.destroyed) say({ error: "internal" });
        },
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  chmodSync(path, 0o600);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const conn of open) conn.destroy();
        try {
          if (lstatSync(path).isSocket()) unlinkSync(path);
        } catch {
          // Already gone.
        }
      }),
  };
}
