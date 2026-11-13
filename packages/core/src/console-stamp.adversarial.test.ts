// The console of a program run by launchd (lot C, 13/11): dated lines, and a
// crash in one line that never prints the error's message nor its stack.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crashLine, installConsoleStamp, type StampTarget, stamp } from "./console-stamp.ts";

const ADDRESS = "someone@example.test";
const INSTALL = join(import.meta.dirname, "console-stamp-install.ts");

function fake() {
  const lines: unknown[][] = [];
  const target: StampTarget = {
    debug: (...a) => lines.push(["debug", ...a]),
    trace: (...a) => lines.push(["trace", ...a]),
    log: (...a) => lines.push(["log", ...a]),
    info: (...a) => lines.push(["info", ...a]),
    warn: (...a) => lines.push(["warn", ...a]),
    error: (...a) => lines.push(["error", ...a]),
  };
  const listeners = new Map<string, (e: unknown) => void>();
  const exits: number[] = [];
  const hooks = {
    on: (event: string, listener: (e: unknown) => void) => listeners.set(event, listener),
    exit: ((code: number) => {
      exits.push(code);
    }) as (code: number) => never,
  };
  return { lines, target, listeners, exits, hooks };
}

describe("dated lines", () => {
  it("the local date and time, zero-padded", () => {
    expect(stamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02 03:04:05");
    expect(stamp(new Date(2026, 10, 13, 23, 59, 59))).toBe("2026-11-13 23:59:59");
  });

  it("every level gets the time first, the arguments untouched after it", () => {
    const f = fake();
    installConsoleStamp(f.target, f.hooks, () => new Date(2026, 10, 13, 12, 0, 0));
    f.target.log("a", 1);
    f.target.info({ k: 2 });
    f.target.warn("w");
    f.target.error("e");
    f.target.debug("d");
    expect(f.lines).toEqual([
      ["log", "2026-11-13 12:00:00", "a", 1],
      ["info", "2026-11-13 12:00:00", { k: 2 }],
      ["warn", "2026-11-13 12:00:00", "w"],
      ["error", "2026-11-13 12:00:00", "e"],
      ["debug", "2026-11-13 12:00:00", "d"],
    ]);
  });

  it("installing twice stamps once, and listens once", () => {
    const f = fake();
    const now = () => new Date(2026, 10, 13, 12, 0, 0);
    installConsoleStamp(f.target, f.hooks, now);
    installConsoleStamp(f.target, f.hooks, now);
    f.target.log("x");
    expect(f.lines).toEqual([["log", "2026-11-13 12:00:00", "x"]]);
  });
});

describe("a crash is one line", () => {
  it.each([
    [
      "uncaughtException",
      Object.assign(new Error(`login failed for ${ADDRESS}`), { code: "28P01" }),
    ],
    ["unhandledRejection", new TypeError(`cannot read ${ADDRESS} in /Users/someone/x.ts`)],
    ["unhandledRejection", ADDRESS],
  ])("%s: the name and code, no message, then exit 1", (event, error) => {
    const f = fake();
    installConsoleStamp(f.target, f.hooks);
    f.listeners.get(event)?.(error);
    expect(f.exits).toEqual([1]);
    expect(f.lines).toHaveLength(1);
    expect(JSON.stringify(f.lines)).not.toContain("example.test");
    expect(JSON.stringify(f.lines)).not.toContain("/Users/");
  });

  it("says what failed", () => {
    expect(crashLine(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(
      "💥 plantage : Error (ECONNREFUSED) — le programme s'arrête, launchd le relance",
    );
  });

  it("exits even if writing the line throws", () => {
    const f = fake();
    installConsoleStamp(f.target, f.hooks);
    f.target.error = () => {
      throw new Error("EPIPE");
    };
    expect(() => f.listeners.get("uncaughtException")?.(new Error("x"))).toThrow();
    expect(f.exits).toEqual([1]);
  });
});

describe("in a real node process, loaded as run.sh loads it", () => {
  const run = (script: string) => {
    const dir = mkdtempSync(join(tmpdir(), "cenacle stamp "));
    const file = join(dir, "p.mjs");
    writeFileSync(file, script);
    return spawnSync(process.execPath, [file], {
      env: { ...process.env, NODE_OPTIONS: `--import="${INSTALL}"` },
      encoding: "utf8",
    });
  };
  const DATED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /;

  it("dates every line, and a thrown error leaves one line, exit 1, no data, no path", () => {
    const r = run(
      `console.log("prêt");\nsetTimeout(() => { throw new Error("for ${ADDRESS}"); }, 1);\n`,
    );
    expect(r.status).toBe(1);
    const lines = `${r.stdout}${r.stderr}`.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(DATED);
    expect(lines[1]).toContain("💥 plantage : Error");
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/example\.test|\/Users\/|at file:/);
  });

  it("a rejected promise nobody awaits: the same one line", () => {
    const r = run(`Promise.reject(new RangeError("${ADDRESS}"));\n`);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toMatch(/^\S+ \S+ 💥 plantage : RangeError — /);
    expect(r.stderr).not.toContain("example.test");
  });

  it("a program that ends well still ends with 0", () => {
    expect(run(`console.log("fini");\n`).status).toBe(0);
  });
});
