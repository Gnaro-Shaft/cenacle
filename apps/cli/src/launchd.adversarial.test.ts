// Iris under launchd (ADR-0018): the plist never holds a secret, survives odd
// paths, restarts after a crash only, and the runner starts Iris exactly like
// `npm run iris`. Installed into a temporary home, with a fake launchctl.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPlist,
  install,
  PROGRAMS,
  type ServiceDeps,
  servicePaths,
  status,
  uninstall,
} from "./launchd.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const RUNNER = join(ROOT, "deploy", "launchd", "run.sh");
const SECRET = "sk-test-NEVER-IN-PLIST-0123456789";

let home = "";
let calls: string[][] = [];
let bootstrapCode = 0;
const saved = { ...process.env };

function deps(over: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    home,
    root: ROOT,
    nodePath: "/opt/node/bin/node",
    uid: 501,
    launchctl: async (args) => {
      calls.push([...args]);
      // A job not loaded: `print` fails, as launchctl does.
      if (args[0] === "print") return { code: 113, output: "" };
      return { code: args[0] === "bootstrap" ? bootstrapCode : 0, output: "" };
    },
    sleep: async () => {},
    ...over,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cenacle-launchd-"));
  calls = [];
  bootstrapCode = 0;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the LaunchAgent", () => {
  it("never holds a secret, even when secrets are loaded at install time", async () => {
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: SECRET,
      CENACLE_MAIL_PASSWORD: SECRET,
      CENACLE_DB_APP_PASSWORD: SECRET,
    });
    const p = await install("iris", deps());
    const plist = readFileSync(p.plist, "utf8");
    expect(plist).not.toContain(SECRET);
    // Only PATH and the log's path: no other variable is ever passed.
    const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(plist)?.[1];
    expect([...(env ?? "").matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual([
      "PATH",
      "CENACLE_LOG",
    ]);
  });

  it("restarts after a crash only — never after /stop — waiting 30 s between starts", () => {
    const plist = buildPlist("iris", deps());
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>/);
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>ThrottleInterval</key><integer>30</integer>");
    // The bot ends its 25 s poll before stopping: launchd waits longer than that.
    expect(plist).toContain("<key>ExitTimeOut</key><integer>40</integer>");
  });

  it("odd paths (spaces, accents, & < > quotes) are escaped, never break the XML", () => {
    const odd = join(home, "Mes Projets & <cénacle> \"x\" 'y'");
    const plist = buildPlist("iris", deps({ root: odd }));
    expect(plist).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    expect(plist).toContain("Mes Projets &amp; &lt;cénacle&gt; &quot;x&quot; &apos;y&apos;");
    if (process.platform === "darwin") {
      const file = join(home, "odd.plist");
      writeFileSync(file, plist);
      expect(() => execFileSync("/usr/bin/plutil", ["-lint", file])).not.toThrow();
    }
  });

  it("refuses an unknown program and relative paths", () => {
    expect(() => servicePaths("nope" as never, deps())).toThrow(/unknown program/);
    expect(() => servicePaths("iris", deps({ home: "relative/home" }))).toThrow(/absolute/);
    expect(() => buildPlist("iris", deps({ nodePath: "node" }))).toThrow(/absolute/);
  });

  it("reinstalling over a running job waits until it has stopped, then starts it", async () => {
    // launchctl bootout returns at once; the job is still known for a while.
    let stillLoaded = 3;
    const order: string[] = [];
    await install(
      "iris",
      deps({
        launchctl: async (args) => {
          order.push(args[0] ?? "");
          if (args[0] === "print") return { code: stillLoaded-- > 0 ? 0 : 113, output: "" };
          if (args[0] === "bootstrap" && stillLoaded >= 0) return { code: 5, output: "" };
          return { code: 0, output: "" };
        },
      }),
    );
    expect(order).toEqual(["bootout", "print", "print", "print", "print", "bootstrap"]);
  });

  it("a job that never stops: an error, and never a bootstrap over it", async () => {
    const order: string[] = [];
    await expect(
      install(
        "iris",
        deps({
          launchctl: async (args) => {
            order.push(args[0] ?? "");
            return { code: 0, output: "" };
          },
        }),
      ),
    ).rejects.toThrow(/ne s'arrête pas/);
    expect(order).not.toContain("bootstrap");
  });

  it("install replaces the previous one; a failed start is an error, not a success", async () => {
    await install("iris", deps());
    expect(calls.map((c) => c[0])).toEqual(["bootout", "print", "bootstrap"]);
    bootstrapCode = 5;
    await expect(install("iris", deps())).rejects.toThrow(/bootstrap failed/);
  });

  it("uninstall removes it, and running it twice is harmless", async () => {
    const p = await install("iris", deps());
    await uninstall("iris", deps());
    await uninstall("iris", deps());
    expect(existsSync(p.plist)).toBe(false);
  });

  it("status shows only a few fields of launchd's output", async () => {
    const output = "state = running\n\tpid = 4242\n\tlast exit code = 0\n\tpath = /secret/where\n";
    const s = await status("iris", deps({ launchctl: async () => ({ code: 0, output }) }));
    expect(s).toEqual({
      installed: false,
      loaded: true,
      state: "running",
      pid: 4242,
      lastExitCode: "0",
    });
    const none = await status(
      "iris",
      deps({ launchctl: async () => ({ code: 113, output: "x" }) }),
    );
    expect(none).toMatchObject({ loaded: false, state: null, pid: null });
  });
});

describe("the runner", () => {
  it.each(["iris", "server", "bot"])(
    "starts %s with exactly the env files of its npm script",
    (program) => {
      const script = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts[program];
      const runner = readFileSync(RUNNER, "utf8");
      const branch = new RegExp(`^${program}\\)\\n([\\s\\S]*?);;`, "m").exec(runner)?.[1] ?? "";
      expect(branch).toContain(`exec ${script}\n`);
    },
  );

  it("starts the page exactly like `npm run web` (apps/web's dev script: vite)", () => {
    const web = JSON.parse(readFileSync(join(ROOT, "apps", "web", "package.json"), "utf8"));
    expect(web.scripts.dev).toBe("vite");
    expect(readFileSync(RUNNER, "utf8")).toMatch(
      /^web\)\n\s*#.*\n\s*cd apps\/web\n\s*exec \.\.\/\.\.\/node_modules\/\.bin\/vite\n/m,
    );
  });

  it("every program has its branch in the runner, and its own plist label", () => {
    const runner = readFileSync(RUNNER, "utf8");
    const labels = new Set<string>();
    for (const program of PROGRAMS) {
      expect(runner).toMatch(new RegExp(`^${program}\\)$`, "m"));
      labels.add(servicePaths(program, deps()).label);
    }
    expect(labels.size).toBe(PROGRAMS.length);
  });

  it("an unknown program: refused (64)", () => {
    expect(spawnSync("/bin/sh", [RUNNER, "rm"]).status).toBe(64);
  });

  it("empties the log beyond 1 MB, keeps it below", () => {
    const big = join(home, "big.log");
    const small = join(home, "small.log");
    writeFileSync(big, "x".repeat(1_048_577));
    writeFileSync(small, "état\n");
    spawnSync("/bin/sh", [RUNNER, "none"], { env: { ...process.env, CENACLE_LOG: big } });
    spawnSync("/bin/sh", [RUNNER, "none"], { env: { ...process.env, CENACLE_LOG: small } });
    expect(readFileSync(big, "utf8")).toBe("");
    expect(readFileSync(small, "utf8")).toBe("état\n");
  });
});
