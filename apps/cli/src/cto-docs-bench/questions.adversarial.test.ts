// The documentation bench's criteria (ADR-0033, § 6): every answer is in the
// versioned documentation, half the questions bear on an old ADR, and a point
// is never given by an answer that only repeats the question.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUESTIONS, score } from "./questions.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const tracked = new Set(
  execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" }).split("\n"),
);

describe("the bench of the CTO's documentation", () => {
  it("fifteen questions, distinct ids and texts", () => {
    expect(QUESTIONS).toHaveLength(15);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(15);
    expect(new Set(QUESTIONS.map((q) => q.question)).size).toBe(15);
  });

  it("at least half bear on an old ADR (0001 to 0016)", () => {
    const old = QUESTIONS.filter((q) => {
      const n = /docs\/adr\/(\d{4})-/.exec(q.source)?.[1];
      return n !== undefined && Number(n) <= 16;
    });
    expect(old.length * 2).toBeGreaterThanOrEqual(QUESTIONS.length);
  });

  it.each(QUESTIONS.map((q) => [q.id, q.source]))(
    "%s: its source %s is versioned documentation, outside the measurement reports",
    (_, source) => {
      expect(tracked.has(source)).toBe(true);
      expect(source).toMatch(/^docs\/.+\.md$/);
      expect(source).not.toMatch(/^docs\/mesures\//);
    },
  );

  it.each(QUESTIONS.map((q) => [q.id, q]))("%s: every point is written in its source", (_, q) => {
    const text = readFileSync(join(ROOT, q.source), "utf8");
    for (const p of q.points) expect(text, String(p)).toMatch(p);
  });

  it.each(QUESTIONS.map((q) => [q.id, q]))(
    "%s: repeating the question gives no right answer",
    (_, q) => {
      expect(score(q, q.question).right).toBe(false);
    },
  );

  it("an empty or unrelated answer scores nothing", () => {
    for (const q of QUESTIONS) {
      expect(score(q, "").points).toBe(0);
      expect(score(q, "Je ne sais pas : il faudrait vérifier.").points).toBe(0);
    }
  });

  it("a right answer is all its points, wherever they are", () => {
    const q = QUESTIONS.find((x) => x.id === "Q06");
    if (q === undefined) throw new Error("no Q06");
    expect(score(q, "Code 75.\n\nEt launchd attend 30 s.")).toMatchObject({
      points: 2,
      right: true,
    });
    expect(score(q, "Code 75 seulement.")).toMatchObject({ points: 1, right: false });
    expect(score(q, "Code 175, 300 s.").points).toBe(0);
  });
});
