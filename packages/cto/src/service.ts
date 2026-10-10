/**
 * The CTO as a service (ADR-0020): one question at a time on the shared model,
 * at most a few waiting (beyond: "busy"), on a local socket only I can open
 * (0600, in a 0700 folder) — no network port, no token. Questions and answers
 * live in memory for the time of the answer: nothing is kept.
 */
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { ModelUnavailableError } from "@cenacle/brain";
import { type CtoProgress, type CtoReply, QuestionError, validQuestion } from "./pipeline.ts";
import { type CtoRequest, decodeRequest, encode, MAX_LINE, type ServiceEvent } from "./protocol.ts";
import { ReviewError, validBranch } from "./review.ts";

export const MAX_WAITING = 3;
/** A caller that does not send its question within this delay is dropped. */
export const REQUEST_TIMEOUT_MS = 5000;

export interface CtoService {
  handle(
    request: CtoRequest,
    send: (event: ServiceEvent) => void,
    gone: () => boolean,
  ): Promise<void>;
}

export function createCtoService(options: {
  readonly ask: (question: string, onProgress: (p: CtoProgress) => void) => Promise<CtoReply>;
  /** Reviews a local branch (ADR-0021); absent, a review is refused. */
  readonly review?: (branch: string, onProgress: (p: CtoProgress) => void) => Promise<CtoReply>;
  /** The compliance look (ADR-0022); absent, it is refused. */
  readonly conformity?: (onProgress: (p: CtoProgress) => void) => Promise<CtoReply>;
  readonly maxWaiting?: number;
}): CtoService {
  const maxWaiting = options.maxWaiting ?? MAX_WAITING;
  let running = false;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) running = false;
    else next();
  };
  return {
    async handle(request, send, gone) {
      let run: (onProgress: (p: CtoProgress) => void) => Promise<CtoReply>;
      try {
        if ("conformity" in request) {
          const conformity = options.conformity;
          if (conformity === undefined) throw new ReviewError("la conformité n'est pas branchée");
          run = (p) => conformity(p);
        } else if ("review" in request) {
          const branch = validBranch(request.review);
          const review = options.review;
          if (review === undefined) throw new ReviewError("la relecture n'est pas branchée");
          run = (p) => review(branch, p);
        } else {
          const text = validQuestion(request.question);
          run = (p) => options.ask(text, p);
        }
      } catch (error) {
        send({ event: "error", code: "invalid", message: (error as Error).message });
        return;
      }
      if (running) {
        if (waiting.length >= maxWaiting) {
          send({ event: "error", code: "busy", message: "le CTO est occupé : réessaie plus tard" });
          return;
        }
        send({ event: "progress", progress: { kind: "queued", ahead: waiting.length + 1 } });
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      running = true;
      try {
        // Gone while waiting: the model is not asked for nobody.
        if (gone()) return;
        let shownAt = 0;
        const reply = await run((progress) => {
          if (progress.kind === "writing") {
            if (Date.now() - shownAt < 1000) return;
            shownAt = Date.now();
          }
          send({ event: "progress", progress });
        });
        send({ event: "answer", reply });
      } catch (error) {
        if (error instanceof ModelUnavailableError) {
          // askAgent names the reason in its message: a timeout is not a dead model.
          const timedOut = error.message.includes("(timeout)");
          send({
            event: "error",
            code: timedOut ? "timeout" : "model_unavailable",
            message: timedOut ? "le CTO n'a pas répondu à temps" : "le modèle local ne répond pas",
          });
        } else if (error instanceof QuestionError || error instanceof ReviewError) {
          send({ event: "error", code: "invalid", message: error.message });
        } else {
          // The message may quote the model server: only a generic word leaves.
          send({ event: "error", code: "internal", message: "erreur interne du CTO" });
        }
      } finally {
        release();
      }
    },
  };
}

/** Listens on the socket; refuses to replace anything that is not a stale socket. */
export async function listenCto(
  path: string,
  service: CtoService,
  options: { readonly requestTimeoutMs?: number } = {},
): Promise<{ close(): Promise<void> }> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  try {
    if (!lstatSync(path).isSocket()) throw new Error(`${path} exists and is not a socket`);
    // A stale socket from a killed service: the instance lock says it is ours.
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Tracked so that a stop never waits for an answer still being written.
  const open = new Set<Socket>();
  const server: Server = createServer((conn) => {
    open.add(conn);
    conn.on("close", () => open.delete(conn));
    conn.setEncoding("utf8");
    let buffer = "";
    let gone = false;
    let asked = false;
    const say = (event: ServiceEvent) => {
      if (!gone) conn.write(encode(event));
    };
    const timer = setTimeout(() => {
      if (!asked) conn.destroy();
    }, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    conn.on("close", () => {
      gone = true;
      clearTimeout(timer);
    });
    conn.on("error", () => {
      gone = true;
    });
    conn.on("data", (chunk: string) => {
      if (asked) return;
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end === -1 && buffer.length <= MAX_LINE) return;
      asked = true;
      clearTimeout(timer);
      let request: CtoRequest;
      try {
        if (end === -1 || end > MAX_LINE) throw new Error("request too long");
        request = decodeRequest(buffer.slice(0, end));
      } catch {
        say({ event: "error", code: "invalid", message: "requête malformée" });
        conn.end();
        return;
      }
      void service.handle(request, say, () => gone).finally(() => conn.end());
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
