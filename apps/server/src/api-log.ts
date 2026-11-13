/**
 * What the API writes in its log when it answers 500 or a stream breaks
 * (lot C, 13/11): the method, the route's pattern — never its values, an id
 * is enough to find nothing — and the error's name and code (errorText),
 * never its message. Before, a 500 left no trace, and a broken stream left a
 * whole stack with the home folder's path.
 */
import { errorText } from "@cenacle/core";
import type { Context } from "hono";

export type ApiLog = (line: string) => void;

export function internalLine(c: Context, error: unknown): string {
  return `⚠ API ${c.req.method} ${c.req.routePath} : ${errorText(error)}`;
}

export function streamLine(c: Context, error: unknown): string {
  return `⚠ API flux ${c.req.routePath} interrompu : ${errorText(error)}`;
}
