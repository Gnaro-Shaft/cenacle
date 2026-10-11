// The only merge (J6d): on my request, and only if nothing moved — open, on
// main, still the commit the CI tested, CI green on it, package files only;
// gh is told that commit. Any doubt: no merge.
import { describe, expect, it } from "vitest";
import { closeOnRequest, mergeOnRequest } from "./merge.ts";

const SHA = "d".repeat(40);
const URL = "https://github.com/o/r/pull/9";
function ops(view: object | string, mergeCode = 0) {
  const calls: string[][] = [];
  return {
    calls,
    ops: {
      root: "/repo",
      gh: "/bin/gh",
      run: async (_file: string, args: readonly string[]) => {
        calls.push([...args]);
        if (args[1] === "view")
          return { code: 0, stdout: typeof view === "string" ? view : JSON.stringify(view) };
        return { code: args[1] === "merge" ? mergeCode : 0, stdout: "" };
      },
    },
  };
}
const good = {
  state: "OPEN",
  statusCheckRollup: [{ conclusion: "SUCCESS" }],
  headRefOid: SHA,
  baseRefName: "main",
  files: [{ path: "package.json" }, { path: "package-lock.json" }],
  commits: [{}],
};

describe("mergeOnRequest", () => {
  it("everything as I saw it: merged on that very commit, clean", async () => {
    const w = ops(good);
    expect(await mergeOnRequest(URL, SHA, w.ops)).toEqual({ ok: true, clean: true });
    expect(w.calls.at(-1)).toEqual(["pr", "merge", URL, "--merge", "--match-head-commit", SHA]);
  });

  it.each([
    ["another commit pushed", { ...good, headRefOid: "e".repeat(40) }, "moved"],
    ["CI no longer green", { ...good, statusCheckRollup: [{ conclusion: "FAILURE" }] }, "ci"],
    ["CI still running", { ...good, statusCheckRollup: [{ status: "IN_PROGRESS" }] }, "ci"],
    ["not on main", { ...good, baseRefName: "dev" }, "base"],
    ["a file other than packages", { ...good, files: [{ path: "apps/x/src/a.ts" }] }, "files"],
    ["no file at all", { ...good, files: [] }, "files"],
    ["already merged", { ...good, state: "MERGED" }, "state"],
    ["closed", { ...good, state: "CLOSED" }, "state"],
    ["unreadable", "garbage", "unknown"],
  ])("%s: no merge", async (_, view, reason) => {
    const w = ops(view);
    expect(await mergeOnRequest(URL, SHA, w.ops)).toEqual({ ok: false, reason });
    expect(w.calls.some((c) => c[1] === "merge")).toBe(false);
  });

  it("gh refuses: said, not merged; two commits: merged but not clean", async () => {
    expect(await mergeOnRequest(URL, SHA, ops(good, 1).ops)).toEqual({ ok: false, reason: "gh" });
    expect(await mergeOnRequest(URL, SHA, ops({ ...good, commits: [{}, {}] }).ops)).toEqual({
      ok: true,
      clean: false,
    });
  });

  it("closing removes the branch", async () => {
    const w = ops(good);
    expect(await closeOnRequest(URL, w.ops)).toBe(true);
    expect(w.calls[0]).toEqual(["pr", "close", URL, "--delete-branch"]);
  });
});
