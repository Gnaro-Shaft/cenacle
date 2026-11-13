// The built page, served by the API (ADR-0037): only dist's files, by an exact
// path — nothing above it, no dot file, no link out —, strict headers on every
// answer, this machine's names only, and never a page built from other sources.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageSourcesHash, SOURCES_STAMP } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig, newToken } from "./guard.ts";
import { builtPageProblem, CSP } from "./page-files.ts";
import type { ProposalsService } from "./proposals-service.ts";

const TOKEN = newToken();
const HOST = { host: "127.0.0.1:8787" };

function site() {
  const web = mkdtempSync(join(tmpdir(), "cenacle-page-"));
  mkdirSync(join(web, "src"));
  writeFileSync(join(web, "src", "main.tsx"), "export {};\n");
  writeFileSync(join(web, "secret.txt"), "outside dist\n");
  const dist = join(web, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Cénacle</title>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log(1);");
  writeFileSync(join(dist, SOURCES_STAMP), `${pageSourcesHash(web)}\n`);
  symlinkSync(join(web, "secret.txt"), join(dist, "assets", "out.txt"));
  const proposals = { list: async () => [] } as unknown as ProposalsService;
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals,
    page: { dist },
  });
  return { web, dist, app };
}

describe("the page's files", () => {
  it("/ is the page: HTML, never cached, with the strict headers", async () => {
    const { app } = site();
    const r = await app.request("/", { headers: HOST });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toBe(CSP);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(await r.text()).toContain("<title>Cénacle</title>");
  });

  it("an asset, with its type; HEAD gives no body", async () => {
    const { app } = site();
    const r = await app.request("/assets/app.js", { headers: HOST });
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(await r.text()).toBe("console.log(1);");
    const head = await app.request("/assets/app.js", { method: "HEAD", headers: HOST });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it.each([
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
    "/assets\\..\\..\\secret.txt",
    "/%2e%2e%5csecret.txt",
    `/${SOURCES_STAMP}`,
    "/assets/out.txt",
    "/assets/app.js%00.html",
    "/assets//app.js",
    "/nope.js",
    "/assets/",
    "/%E0%A4%A",
  ])("never %j", async (path) => {
    const { app } = site();
    const r = await app.request(path, { headers: HOST });
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("outside dist");
  });

  it("only GET and HEAD", async () => {
    const { app } = site();
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await app.request("/", { method, headers: HOST })).status).toBe(404);
    }
  });

  it("another name pointed at this machine gets nothing, not even the page", async () => {
    const { app } = site();
    expect((await app.request("/", { headers: { host: "evil.example:8787" } })).status).toBe(421);
    expect((await app.request("/", { headers: { host: "127.0.0.1:5173" } })).status).toBe(421);
  });

  it("the page needs no token; the API still does, and wears the same headers", async () => {
    const { app } = site();
    expect((await app.request("/", { headers: HOST })).status).toBe(200);
    const api = await app.request("/api/proposals", { headers: HOST });
    expect(api.status).toBe(401);
    expect(api.headers.get("content-security-policy")).toBe(CSP);
  });
});

describe("never two versions (ADR-0037, point 3)", () => {
  it("a page built from these sources is served", () => {
    expect(builtPageProblem(site().web)).toBeNull();
  });

  it("a source changed since the build: refused", () => {
    const { web } = site();
    writeFileSync(join(web, "src", "main.tsx"), "export const changed = 1;\n");
    expect(builtPageProblem(web)).toMatch(/d'autres sources/);
  });

  it("a test changed since the build: still served (tests are not the page)", () => {
    const { web } = site();
    writeFileSync(join(web, "src", "page.adversarial.test.ts"), "// a test\n");
    expect(builtPageProblem(web)).toBeNull();
  });

  it("no build, or no fingerprint: refused, and it says how to build", () => {
    const empty = mkdtempSync(join(tmpdir(), "cenacle-page-"));
    expect(builtPageProblem(empty)).toMatch(/pas compilée.*npm run web:build/);
    const { web, dist } = site();
    writeFileSync(join(dist, SOURCES_STAMP), "");
    expect(builtPageProblem(web)).toMatch(/d'autres sources/);
  });
});

describe("the origin that may act is the API's own (ADR-0037, point 4)", () => {
  it("by default, only the API's port; the Vite dev port only when asked", () => {
    const prod = defaultGuardConfig(TOKEN);
    expect(prod.origins).toEqual(["http://127.0.0.1:8787", "http://localhost:8787"]);
    expect(prod.hosts).not.toContain("127.0.0.1:5173");
    const dev = defaultGuardConfig(TOKEN, 8787, { devPage: true });
    expect(dev.origins).toContain("http://127.0.0.1:5173");
    expect(dev.hosts).toContain("127.0.0.1:5173");
  });
});
