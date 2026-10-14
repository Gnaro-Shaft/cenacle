/**
 * Running the security agent's checks (J6a): fixed programs, absolute paths,
 * no shell, no sudo, read-only, a short environment, a time limit and a
 * capped output. A program that fails, times out or answers something
 * unexpected makes its check "could not run" — never "all is well".
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CheckResult,
  LEGION_VERDICT_PATH,
  npmCheck,
  type Observation,
  operatorObservations,
  PROJECTS_CHECK,
  type Project,
  parseFileVault,
  parseFirewall,
  parseGatekeeper,
  parseGitleaks,
  parseLegionVerdict,
  parseNpmAudit,
  parseNpmOutdated,
  parseProjectNpmAudit,
  parseProjects,
  parseServerSwitch,
  parseSip,
  parseSoftwareUpdate,
  parseTailscale,
  secretsCheck,
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
  /** What must hold before the program can prove anything; otherwise the check could not run. */
  readonly ready?: () => boolean;
  readonly parse: (out: string) => Observation[];
}

export const firstExisting = (...paths: string[]) =>
  paths.find((p) => existsSync(p)) ?? paths[0] ?? "";

export { LEGION_VERDICT_PATH } from "@cenacle/securite";

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

/** My other projects (J6e2): securite.local.toml at the root; absent, no project. */
export const PROJECTS_FILE = "securite.local.toml";

export function loadProjects(root: string): Project[] | null {
  const file = join(root, PROJECTS_FILE);
  if (!existsSync(file)) return [];
  try {
    return parseProjects(readFileSync(file, "utf8"));
  } catch {
    // Said as a finding ("projets" could not run), never a failed round.
    return null;
  }
}

export const GITLEAKS = firstExisting("/opt/homebrew/bin/gitleaks", "/usr/local/bin/gitleaks");

/** Read-only audits in each project, with the network checks (once an hour). */
export function projectSpecs(
  projects: readonly Project[],
  nodeDir: string,
  gitleaks: string = GITLEAKS,
): Spec[] {
  const npm = `${nodeDir}/npm`;
  return projects.flatMap((p): Spec[] => [
    ...(p.npm
      ? [
          {
            check: npmCheck(p.name),
            file: npm,
            // The lock file only: nothing installed, nothing changed in the project.
            args: ["audit", "--json", "--package-lock-only"],
            cwd: p.path,
            codes: [0, 1],
            parse: (out: string) => parseProjectNpmAudit(out, p.name),
          },
        ]
      : []),
    ...(p.secrets
      ? [
          {
            check: secretsCheck(p.name),
            file: gitleaks,
            // Committed history only; the secret is masked, and never read anyway.
            args: [
              "git",
              "--redact",
              "--no-banner",
              "--report-format",
              "json",
              "--report-path",
              "-",
              "--exit-code",
              "2",
              "--log-level",
              "error",
              p.path,
            ],
            cwd: p.path,
            codes: [0, 2],
            // Outside a git repository gitleaks answers "nothing found": that proves nothing.
            ready: () => existsSync(join(p.path, ".git")),
            parse: (out: string) => parseGitleaks(out, p.name),
          },
        ]
      : []),
  ]);
}

/** The list itself, as a check: unreadable, it is a finding; readable again, that one resolves. */
export const projectsResult = (projects: readonly Project[] | null): CheckResult =>
  projects === null
    ? { check: PROJECTS_CHECK, ran: false }
    : { check: PROJECTS_CHECK, ran: true, observations: [] };

/**
 * The operator, blocked or silent (2026-10-14): its state file, read every
 * round with the switch of securite.toml — never serveurs.local.toml itself,
 * which is the operator's alone. Always "ran": an absent state is a finding.
 */
export const OPERATOR_CHECK = "operateur";
export function operatorResult(
  state: string | null,
  securiteToml: string,
  nowMs: number,
): CheckResult {
  return {
    check: OPERATOR_CHECK,
    ran: true,
    observations: operatorObservations(state, parseServerSwitch(securiteToml), nowMs),
  };
}

export async function runChecks(list: readonly Spec[], run: Run): Promise<CheckResult[]> {
  return Promise.all(
    list.map(async (s): Promise<CheckResult> => {
      try {
        if (s.ready !== undefined && !s.ready()) return { check: s.check, ran: false };
        const { code, stdout } = await run(s.file, s.args, s.cwd);
        if (!s.codes.includes(code)) return { check: s.check, ran: false };
        return { check: s.check, ran: true, observations: s.parse(stdout) };
      } catch {
        return { check: s.check, ran: false };
      }
    }),
  );
}
