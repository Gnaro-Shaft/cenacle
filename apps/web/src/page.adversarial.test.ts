// The page's look (2026-10-14), held: nothing fetched from a third party,
// the fonts served by the page with their licence (the repository is public),
// each ring styled, the only animation stopped on request, no emoji left for
// a meaning colour or words should carry, and a preview that calls nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RINGS } from "./presence.ts";

const WEB = join(import.meta.dirname, "..");
const SRC = import.meta.dirname;
const read = (path: string) => readFileSync(path, "utf8");
const sources = readdirSync(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));
const css = readdirSync(SRC)
  .filter((f) => f.endsWith(".css"))
  .map((f) => read(join(SRC, f)))
  .join("\n");

describe("the page's look", () => {
  it("loads nothing from another host: no http(s) URL, no @import, in sources and pages", () => {
    const pages = ["index.html", "apercu.html"].map((f) => read(join(WEB, f)));
    for (const [name, text] of [
      ...sources.map((f) => [f, read(join(SRC, f))]),
      ...pages.map((t, i) => [`page ${i}`, t]),
    ]) {
      expect(text, name).not.toMatch(/https?:\/\//);
      expect(text, name).not.toMatch(/@import/);
    }
  });

  it("the three fonts are served by the page, each with its full licence", () => {
    const dir = join(WEB, "public", "polices");
    for (const font of ["fraunces.woff2", "newsreader.woff2", "newsreader-italique.woff2"]) {
      expect(existsSync(join(dir, font)), font).toBe(true);
      expect(css).toContain(`url("/polices/${font}")`);
    }
    for (const licence of ["OFL-fraunces.txt", "OFL-newsreader.txt"]) {
      expect(read(join(dir, licence))).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
    expect(read(join(dir, "LICENCES.md"))).toMatch(/OFL-fraunces\.txt[\s\S]*OFL-newsreader\.txt/);
  });

  it("every ring has its style, and the pulse stops when less motion is asked", () => {
    for (const ring of RINGS) {
      if (ring !== "repos") expect(css, ring).toContain(`.anneau-${ring} .anneau`);
    }
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.anneau-travail \.anneau\s*\{\s*animation: none;/,
    );
    expect(css.match(/animation:/g)?.length).toBe(2);
  });

  it("no emoji in the components: the state is said by ring and words", () => {
    for (const f of sources.filter((s) => s.endsWith(".tsx"))) {
      expect(read(join(SRC, f)), f).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("the preview replaces fetch before anything renders, and opens no stream", () => {
    const preview = read(join(SRC, "apercu.tsx"));
    expect(preview.indexOf("window.fetch =")).toBeGreaterThan(0);
    expect(preview.indexOf("window.fetch =")).toBeLessThan(preview.indexOf("createRoot("));
    expect(preview).not.toMatch(/AgentBox|useTeamStream|EventSource/);
  });

  it("the real page keeps its stream, its token and its API calls where they were", () => {
    const app = read(join(SRC, "App.tsx"));
    expect(app).toContain("useTeamStream(AGENTS)");
    expect(app).toContain("takeToken()");
    expect(app).toMatch(/<Proposals token=\{token\}/);
    expect(app).toMatch(/<CtoAsk token=\{token\}/);
  });

  it("one stream for the whole team, never one per card (2026-10-26: six cards, six connections, a page that hung)", () => {
    const opened = sources
      .map((f) => [f, (read(join(SRC, f)).match(/new EventSource\(/g) ?? []).length] as const)
      .filter(([, n]) => n > 0);
    expect(opened).toEqual([["useTeamStream.ts", 1]]);
    expect(read(join(SRC, "AgentBox.tsx"))).not.toMatch(/EventSource|useTeamStream\(/);
    expect(read(join(SRC, "App.tsx")).match(/useTeamStream\(/g)).toHaveLength(1);
  });
});
