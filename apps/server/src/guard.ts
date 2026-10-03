/**
 * Who may call the API (phase 4, B3 — decided 03/10).
 *
 * - Host: only the names of this machine. A web page cannot point another
 *   domain name at 127.0.0.1 and talk to the API ("DNS rebinding").
 * - Proposals (drafts are mail content; buttons act): a token drawn at each
 *   start of the server, shown once in its terminal, sent by the page in a
 *   header. Another page of the browser does not know it, and cannot set
 *   that header across origins without a preflight that is never granted.
 * - Actions (POST/PUT): also the page's own origin, and JSON only.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export interface GuardConfig {
  readonly token: string;
  /** host:port values accepted in the Host header. */
  readonly hosts: readonly string[];
  /** Origins allowed to act (the page). */
  readonly origins: readonly string[];
}

export const newToken = (): string => randomBytes(32).toString("base64url");

const API_PORT = 8787;
const WEB_PORT = 5173;
export function defaultGuardConfig(token: string, apiPort = API_PORT): GuardConfig {
  const names = ["127.0.0.1", "localhost"];
  return {
    token,
    hosts: names.flatMap((n) => [`${n}:${apiPort}`, `${n}:${WEB_PORT}`]),
    origins: names.map((n) => `http://${n}:${WEB_PORT}`),
  };
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hostGuard(config: GuardConfig): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!config.hosts.includes(host)) return c.json({ error: "unknown host" }, 421);
    await next();
  };
}

export function tokenGuard(config: GuardConfig): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!sameSecret(given, config.token)) return c.json({ error: "token required" }, 401);
    if (c.req.method !== "GET") {
      const origin = c.req.header("origin");
      if (origin === undefined || !config.origins.includes(origin)) {
        return c.json({ error: "origin refused" }, 403);
      }
      const type = c.req.header("content-type") ?? "";
      if (!type.startsWith("application/json")) return c.json({ error: "JSON only" }, 415);
    }
    await next();
    c.header("Cache-Control", "no-store");
  };
}
