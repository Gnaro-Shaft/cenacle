/**
 * The built page, served by the API itself (ADR-0037). Only the files of
 * apps/web/dist, by an exact path under it — never ../, never a file outside,
 * never a dot file (the sources' fingerprint stays private). Strict security
 * headers on every answer, the page's and the API's.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pageSourcesHash, SOURCES_STAMP } from "@cenacle/core";
import type { MiddlewareHandler } from "hono";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Nothing from elsewhere, nothing inline, never in a frame (ADR-0037, point 5). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
};

/**
 * Why the built page cannot be served, or null: missing, or built from other
 * sources than the ones here (ADR-0037, point 3 — never two versions).
 */
export function builtPageProblem(webDir: string): string | null {
  const dist = join(webDir, "dist");
  if (!existsSync(join(dist, "index.html"))) {
    return "la page n'est pas compilée (npm run web:build)";
  }
  const stamp = join(dist, SOURCES_STAMP);
  if (!existsSync(stamp)) return "la page compilée n'a pas d'empreinte (npm run web:build)";
  if (readFileSync(stamp, "utf8").trim() !== pageSourcesHash(webDir)) {
    return "la page compilée date d'autres sources (npm run web:build)";
  }
  return null;
}

/** The file under dist that a URL path names, or null: never outside, never a dot file. */
export function pageFile(dist: string, urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (path === "/" || path === "") path = "/index.html";
  if (!path.startsWith("/") || /[\\\0]/.test(path)) return null;
  const parts = path.slice(1).split("/");
  if (parts.some((p) => p === "" || p.startsWith(".")) || !(extname(path) in TYPES)) return null;
  const root = realpathSync(dist);
  const file = resolve(root, ...parts);
  if (!file.startsWith(root + sep)) return null;
  try {
    // A link inside dist pointing out of it is refused too.
    const real = realpathSync(file);
    return real.startsWith(root + sep) && statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** GET and HEAD of the page's files; anything else outside /api is not found. */
export function servePage(dist: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("not found", 404);
    const file = pageFile(dist, c.req.path);
    if (file === null) return c.text("not found", 404);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    // The page itself is never cached: it names this build's assets.
    const cache = file.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable";
    const headers = { "Content-Type": type, "Cache-Control": cache };
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(new Uint8Array(readFileSync(file)).buffer, 200, headers);
  };
}
