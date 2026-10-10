/**
 * Running the security agent's checks (J6a): fixed programs, absolute paths,
 * no shell, no sudo, read-only, a short environment, a time limit and a
 * capped output. A program that fails, times out or answers something
 * unexpected makes its check "could not run" — never "all is well".
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type CheckResult,
  type Observation,
  parseFileVault,
  parseFirewall,
  parseGatekeeper,
  parseLegionVerdict,
  parseNpmAudit,
  parseNpmOutdated,
  parseSip,
  parseSoftwareUpdate,
  parseTailscale,
} from "@cenacle/securite";

export interface Run {
  /** Exit code, and stdout even when the code is not 0 (npm audit, npm outdated). */
  (file: string, args: readonly string[], cwd?: string): Promise<{ code: number; stdout: string }>;
}

export function runProgram(timeoutMs = 120_000): Run {
  return (file, args, cwd) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 8_000_000,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            LANG: "C",
            HOME: process.env.HOME ?? "",
          },
        },
        (error, stdout) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
          resolve({ code, stdout: String(stdout) });
        },
      );
    });
}

interface Spec {
  readonly check: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Exit codes that still carry an answer. */
  readonly codes: readonly number[];
  readonly parse: (out: string) => Observation[];
}

const firstExisting = (...paths: string[]) => paths.find((p) => existsSync(p)) ?? paths[0] ?? "";

/** Where Legion's reader leaves the raw verdict (the bridge, ADR-0025). */
export const LEGION_VERDICT_PATH =
  process.env.LEGION_VERDICT_PATH ??
  `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.legion.ronde.verdict`;

export function specs(root: string, nodeDir: string, macMajor: number): Spec[] {
  const npm = `${nodeDir}/npm`;
  return [
    {
      check: "legion_ronde",
      file: "/bin/cat",
      args: [LEGION_VERDICT_PATH],
      codes: [0],
      parse: (out) => parseLegionVerdict(out, Date.now()),
    },
    {
      check: "filevault",
      file: "/usr/bin/fdesetup",
      args: ["status"],
      codes: [0],
      parse: parseFileVault,
    },
    {
      check: "firewall",
      file: "/usr/libexec/ApplicationFirewall/socketfilterfw",
      args: ["--getglobalstate"],
      codes: [0],
      parse: parseFirewall,
    },
    { check: "sip", file: "/usr/bin/csrutil", args: ["status"], codes: [0], parse: parseSip },
    {
      check: "gatekeeper",
      file: "/usr/sbin/spctl",
      args: ["--status"],
      codes: [0, 1],
      parse: parseGatekeeper,
    },
    {
      check: "softwareupdate",
      file: "/usr/sbin/softwareupdate",
      args: ["-l"],
      codes: [0],
      parse: (o) => parseSoftwareUpdate(o, macMajor),
    },
    {
      check: "tailscale",
      file: firstExisting(
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      ),
      args: ["version", "--upstream", "--json"],
      codes: [0],
      parse: parseTailscale,
    },
    {
      check: "npm_audit",
      file: npm,
      args: ["audit", "--json"],
      cwd: root,
      codes: [0, 1],
      parse: parseNpmAudit,
    },
    {
      check: "npm_outdated",
      file: npm,
      args: ["outdated", "--json"],
      cwd: root,
      codes: [0, 1],
      parse: parseNpmOutdated,
    },
  ];
}

export async function runChecks(list: readonly Spec[], run: Run): Promise<CheckResult[]> {
  return Promise.all(
    list.map(async (s): Promise<CheckResult> => {
      try {
        const { code, stdout } = await run(s.file, s.args, s.cwd);
        if (!s.codes.includes(code)) return { check: s.check, ran: false };
        return { check: s.check, ran: true, observations: s.parse(stdout) };
      } catch {
        return { check: s.check, ran: false };
      }
    }),
  );
}
