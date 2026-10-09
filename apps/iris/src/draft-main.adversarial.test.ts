// `npm run iris:draft` never prints an error's message (found by the CTO's
// review, 2026-10-09): a mail server's message may quote its host, an
// account or an address. Only the error's name reaches the terminal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("iris:draft on error", () => {
  it("prints the error's name, never its message", () => {
    const source = readFileSync(join(import.meta.dirname, "draft-main.ts"), "utf8");
    const printed = [...source.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1] ?? "");
    expect(printed.length).toBeGreaterThan(0);
    for (const args of printed) expect(args).not.toMatch(/\.message\b/);
    expect(source).toMatch(/error instanceof Error \? error\.name/);
  });
});
