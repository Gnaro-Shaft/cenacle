/**
 * Cénacle's programs under launchd (ADR-0018, ADR-0019): Iris, the page's
 * server, the Telegram bot and the page. Each LaunchAgent is written on this Mac at
 * install time, from the paths found then — none is stored in the repository.
 * It names files, never values: no secret is ever copied into the plist.
 * Restarted after a crash only (SuccessfulExit false): never after /stop.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export const PROGRAMS = ["iris", "server", "bot", "web"] as const;
export type Program = (typeof PROGRAMS)[number];

export interface ServicePaths {
  readonly label: string;
  readonly plist: string;
  readonly log: string;
  readonly runner: string;
}

export interface ServiceDeps {
  /** The user's home directory. */
  readonly home: string;
  /** The repository root. */
  readonly root: string;
  /** The node binary: its folder is the only PATH entry added. */
  readonly nodePath: string;
  /** Runs `launchctl` with these arguments; resolves its exit code and output. */
  readonly launchctl: (args: readonly string[]) => Promise<{ code: number; output: string }>;
  /** The user's id, for the gui/<uid> domain. */
  readonly uid: number;
}

/** Seconds launchd waits between two starts: Docker or the model may still be starting. */
export const THROTTLE_SECONDS = 30;
/** Seconds launchd waits after SIGTERM before SIGKILL: the bot ends its 25 s poll first. */
export const EXIT_TIMEOUT_SECONDS = 40;

export function servicePaths(program: Program, deps: Pick<ServiceDeps, "home" | "root">) {
  if (!(PROGRAMS as readonly string[]).includes(program)) {
    throw new Error(`unknown program ${JSON.stringify(program)}`);
  }
  for (const [name, path] of [
    ["home", deps.home],
    ["root", deps.root],
  ] as const) {
    if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path`);
  }
  const label = `org.cenacle.${program}`;
  return {
    label,
    plist: join(deps.home, "Library", "LaunchAgents", `${label}.plist`),
    log: join(deps.home, "Library", "Logs", "cenacle", `${program}.log`),
    runner: join(deps.root, "deploy", "launchd", "run.sh"),
  } satisfies ServicePaths;
}

const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const str = (text: string) => `<string>${xml(text)}</string>`;

/** The LaunchAgent, as XML. Only paths and fixed settings: never an environment value. */
export function buildPlist(
  program: Program,
  deps: Pick<ServiceDeps, "home" | "root" | "nodePath">,
) {
  const p = servicePaths(program, deps);
  if (!isAbsolute(deps.nodePath)) throw new Error("nodePath must be an absolute path");
  const path = [dirname(deps.nodePath), "/usr/bin", "/bin"].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(p.label)}
  <key>ProgramArguments</key>
  <array>${str("/bin/sh")}${str(p.runner)}${str(program)}</array>
  <key>WorkingDirectory</key>${str(deps.root)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${str(path)}
    <key>CENACLE_LOG</key>${str(p.log)}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>${THROTTLE_SECONDS}</integer>
  <key>ExitTimeOut</key><integer>${EXIT_TIMEOUT_SECONDS}</integer>
  <key>StandardOutPath</key>${str(p.log)}
  <key>StandardErrorPath</key>${str(p.log)}
</dict>
</plist>
`;
}

/** Writes the LaunchAgent and starts it. Running it again replaces the previous one. */
export async function install(program: Program, deps: ServiceDeps): Promise<ServicePaths> {
  const p = servicePaths(program, deps);
  if (!existsSync(p.runner)) throw new Error(`runner missing: ${p.runner}`);
  const plist = buildPlist(program, deps);
  mkdirSync(dirname(p.plist), { recursive: true });
  mkdirSync(dirname(p.log), { recursive: true, mode: 0o700 });
  // A previous version, if any, is stopped first; "not loaded" is fine.
  await deps.launchctl(["bootout", `gui/${deps.uid}/${p.label}`]);
  writeFileSync(p.plist, plist, { mode: 0o644 });
  chmodSync(p.plist, 0o644);
  const started = await deps.launchctl(["bootstrap", `gui/${deps.uid}`, p.plist]);
  if (started.code !== 0) throw new Error(`launchctl bootstrap failed (${started.code})`);
  return p;
}

/** Stops it and removes the LaunchAgent. Harmless when nothing is installed. */
export async function uninstall(program: Program, deps: ServiceDeps): Promise<ServicePaths> {
  const p = servicePaths(program, deps);
  await deps.launchctl(["bootout", `gui/${deps.uid}/${p.label}`]);
  rmSync(p.plist, { force: true });
  return p;
}

export interface ServiceStatus {
  readonly installed: boolean;
  readonly loaded: boolean;
  readonly state: string | null;
  readonly pid: number | null;
  readonly lastExitCode: string | null;
}

/** What launchd says, reduced to a few fields (nothing else of its output is shown). */
export async function status(program: Program, deps: ServiceDeps): Promise<ServiceStatus> {
  const p = servicePaths(program, deps);
  const printed = await deps.launchctl(["print", `gui/${deps.uid}/${p.label}`]);
  const field = (name: string) =>
    new RegExp(`^\\s*${name} = (.+)$`, "m").exec(printed.output)?.[1]?.trim() ?? null;
  const pid = field("pid");
  return {
    installed: existsSync(p.plist),
    loaded: printed.code === 0,
    state: printed.code === 0 ? field("state") : null,
    pid: pid !== null && /^\d+$/.test(pid) ? Number(pid) : null,
    lastExitCode: printed.code === 0 ? field("last exit code") : null,
  };
}
