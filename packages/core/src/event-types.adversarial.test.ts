// Every event type the code writes must be known to the projection: an
// unknown one stops it, and the page shows Iris sick (found on 2026-10-05:
// send.unsigned, mail.set_aside, purge.done and purge.failed were written for
// weeks and never declared). And a failed purge must be seen, not only journaled.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentEvent, isKnownEventType, projectStatus } from "./agent-status.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
/** `type: "…"` literals that are not journal events (key formats of node:crypto). */
const NOT_EVENTS: ReadonlySet<string> = new Set(["pkcs8", "spki"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "dist"].includes(entry.name) ? [] : sources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function emittedTypes(): Set<string> {
  const found = new Set<string>();
  for (const top of ["apps", "packages"]) {
    for (const pkg of readdirSync(join(ROOT, top))) {
      let files: string[] = [];
      try {
        files = sources(join(ROOT, top, pkg, "src"));
      } catch {
        continue; // no src directory
      }
      for (const file of files) {
        for (const m of readFileSync(file, "utf8").matchAll(/type: "([a-z][a-z0-9_.]+)"/g)) {
          if (m[1] !== undefined && !NOT_EVENTS.has(m[1])) found.add(m[1]);
        }
      }
    }
  }
  return found;
}

describe("every event type written by the code is known to the projection", () => {
  const types = emittedTypes();

  it("the scan finds the events (it cannot pass by finding nothing)", () => {
    expect(types.size).toBeGreaterThan(20);
    for (const t of ["state.changed", "send.sent", "purge.done", "mail.set_aside"]) {
      expect(types).toContain(t);
    }
  });

  it("none is unknown", () => {
    expect([...types].filter((t) => !isKnownEventType(t))).toEqual([]);
  });

  it("an undeclared type is still refused (the check is not a blanket pass)", () => {
    expect(isKnownEventType("send.unsigned")).toBe(true);
    expect(isKnownEventType("send.unsignd")).toBe(false);
    expect(isKnownEventType("")).toBe(false);
  });
});

const ev = (id: number, type: string, payload: Record<string, unknown> = {}): AgentEvent => ({
  id: BigInt(id),
  occurredAt: new Date(0),
  agent: "iris",
  type,
  payload,
});

describe("a failed purge shows Iris sick until a purge succeeds (C1)", () => {
  it("purge.failed: sick, with its note", () => {
    const s = projectStatus("iris", [ev(1, "purge.failed", { reason: "Error" })]);
    expect(s.view).toEqual({ visual: "sick", note: "purge_failed" });
    expect(s.purgeFailing).toBe(true);
  });

  it("a later state change does not hide it", () => {
    const s = projectStatus("iris", [
      ev(1, "purge.failed", { reason: "Error" }),
      ev(2, "state.changed", { to: "reading" }),
      ev(3, "state.changed", { to: "idle" }),
    ]);
    expect(s.internal).toBe("idle");
    expect(s.view).toEqual({ visual: "sick", note: "purge_failed" });
  });

  it("a successful purge clears it, back to the real state", () => {
    const s = projectStatus("iris", [
      ev(1, "state.changed", { to: "reading" }),
      ev(2, "purge.failed", { reason: "Error" }),
      ev(3, "purge.done", { mails: 0 }),
    ]);
    expect(s.purgeFailing).toBe(false);
    expect(s.view).toEqual({ visual: "working", note: null });
  });

  it("a real error stays an error after a successful purge", () => {
    const s = projectStatus("iris", [
      ev(1, "state.changed", { to: "error" }),
      ev(2, "purge.done", {}),
    ]);
    expect(s.view).toEqual({ visual: "sick", note: null });
  });

  it("the events of the B7 forgeries and of the article 9 floor no longer stop the projection", () => {
    const s = projectStatus("iris", [
      ev(1, "send.unsigned", { proposalId: "forged-b7-1" }),
      ev(2, "mail.set_aside", { count: 2 }),
      ev(3, "purge.done", {}),
    ]);
    expect(s.view).toEqual({ visual: "resting", note: null });
  });
});
