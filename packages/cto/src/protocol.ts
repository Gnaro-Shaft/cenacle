/**
 * What goes over the CTO's local socket (ADR-0020): one JSON object per line,
 * told apart by `event` (never `type`: these are not journal events).
 * The caller sends one request; the service answers with progress lines, then
 * one answer or one error, and closes. Every line is checked on both sides:
 * a malformed one is refused, never guessed.
 */
import { join } from "node:path";
import type { CtoProgress, CtoReply } from "./pipeline.ts";

/** The longest line either side accepts. */
export const MAX_LINE = 64 * 1024;

export type ErrorCode = "invalid" | "busy" | "model_unavailable" | "internal";

export type ServiceEvent =
  | { readonly event: "progress"; readonly progress: CtoProgress }
  | { readonly event: "answer"; readonly reply: CtoReply }
  | { readonly event: "error"; readonly code: ErrorCode; readonly message: string };

/** macOS caps a socket path at 104 bytes. */
const MAX_SOCKET_PATH = 103;

export function ctoSocketPath(home: string): string {
  const path = join(home, "Library", "Application Support", "cenacle", "cto.sock");
  if (Buffer.byteLength(path) > MAX_SOCKET_PATH) throw new Error("socket path too long");
  return path;
}

export function encode(message: object): string {
  const line = JSON.stringify(message);
  if (line.length > MAX_LINE) throw new Error("message too long");
  return `${line}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The request: `{"question": "..."}` and nothing else. */
export function decodeRequest(line: string): unknown {
  const value: unknown = JSON.parse(line);
  if (!isObject(value) || Object.keys(value).join() !== "question") {
    throw new Error("invalid request");
  }
  return value.question;
}

const CODES: readonly ErrorCode[] = ["invalid", "busy", "model_unavailable", "internal"];

/** A line from the service, checked field by field. */
export function decodeEvent(line: string): ServiceEvent {
  const value: unknown = JSON.parse(line);
  if (!isObject(value)) throw new Error("invalid event");
  if (value.event === "progress" && isObject(value.progress)) {
    return { event: "progress", progress: value.progress as unknown as CtoProgress };
  }
  if (value.event === "error" && CODES.includes(value.code as ErrorCode)) {
    return {
      event: "error",
      code: value.code as ErrorCode,
      message: typeof value.message === "string" ? value.message : "",
    };
  }
  if (value.event === "answer" && isObject(value.reply)) {
    const r = value.reply;
    if (
      typeof r.text === "string" &&
      typeof r.summary === "string" &&
      typeof r.cut === "boolean" &&
      typeof r.revised === "boolean" &&
      typeof r.seconds === "number" &&
      typeof r.documents === "number"
    ) {
      return {
        event: "answer",
        reply: {
          text: r.text,
          summary: r.summary,
          cut: r.cut,
          revised: r.revised,
          seconds: r.seconds,
          documents: r.documents,
        },
      };
    }
  }
  throw new Error("invalid event");
}
