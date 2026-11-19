// ADR-0044, point 7: the writers stopped while the tables are reloaded, and
// started again. Only those loaded are touched; each is waited for until
// launchd no longer knows it; one that will not stop stops the restore, and
// the others start again. A writer that does not start again is said.
import { describe, expect, it } from "vitest";
import { resumeWriters, type ServiceDeps, stopWriters, WRITERS } from "./services.ts";

/**
 * A launchd with `loaded` jobs. A job booted out stays known for `lag` more
 * looks (Infinity: it never stops). A bootstrap of `refuseStart` fails.
 */
function launchd(loaded: string[], lag: Record<string, number> = {}, refuseStart: string[] = []) {
  const known = new Set(loaded);
  const stopping = new Map<string, number>();
  const calls: string[] = [];
  const program = (s: string) => s.replace(/^.*org\.cenacle\.(\w+)(\.plist)?$/, "$1");
  const deps: ServiceDeps = {
    uid: 501,
    home: "/Users/essai",
    pause: async () => undefined,
    launchctl: async (args) => {
      calls.push(args.join(" "));
      const [verb = "", target = "", plist = ""] = args;
      const p = program(target);
      if (verb === "print") {
        if (!known.has(p)) return { code: 113, output: "" };
        const left = stopping.get(p);
        if (left === 0) {
          known.delete(p);
          stopping.delete(p);
          return { code: 113, output: "" };
        }
        if (left !== undefined) stopping.set(p, left - 1);
        return { code: 0, output: "" };
      }
      if (verb === "bootout") {
        stopping.set(p, lag[p] ?? 0);
        return { code: 0, output: "" };
      }
      if (verb === "bootstrap") {
        return { code: refuseStart.includes(program(plist)) ? 5 : 0, output: "" };
      }
      return { code: 1, output: "" };
    },
  };
  return { deps, calls };
}

const bootstraps = (calls: string[]) => calls.filter((c) => c.startsWith("bootstrap"));
const plist = (p: string) =>
  `bootstrap gui/501 /Users/essai/Library/LaunchAgents/org.cenacle.${p}.plist`;

describe("stopWriters / resumeWriters", () => {
  it("stops the loaded writers only, waits for each, starts them again from their plist", async () => {
    const { deps, calls } = launchd(["bot", "veille", "iris", "copie"], { veille: 3 });
    const stopped = await stopWriters(deps);
    expect(stopped).toEqual(["bot", "veille"]);
    expect(calls.filter((c) => c.startsWith("bootout"))).toEqual([
      "bootout gui/501/org.cenacle.bot",
      "bootout gui/501/org.cenacle.veille",
    ]);
    // Waited for: veille looked at until launchd no longer knew it.
    const looks = calls.filter((c) => c === "print gui/501/org.cenacle.veille").length;
    expect(looks).toBe(5);
    expect(await resumeWriters(deps, stopped)).toEqual([]);
    expect(bootstraps(calls)).toEqual([plist("bot"), plist("veille")]);
  });

  it("never touches a program that writes none of the four tables", () => {
    for (const p of ["iris", "cto", "copie", "ronde"]) expect(WRITERS).not.toContain(p);
    for (const p of ["bot", "server", "securite", "veille", "prospection", "operateur"]) {
      expect(WRITERS).toContain(p);
    }
  });

  it("one that will not stop: the restore stops, the others start again", async () => {
    const { deps, calls } = launchd(["bot", "server", "securite"], { securite: Infinity });
    await expect(stopWriters(deps)).rejects.toThrow(
      /securite ne s'arrête pas : rien n'est restauré/,
    );
    expect(bootstraps(calls)).toEqual([plist("bot"), plist("server")]);
  });

  it("says which did not start again", async () => {
    const { deps } = launchd(["bot", "server"], {}, ["server"]);
    const stopped = await stopWriters(deps);
    expect(await resumeWriters(deps, stopped)).toEqual(["server"]);
  });
});
