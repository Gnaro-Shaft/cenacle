/**
 * The console of a program run by launchd (lot C, 13/11): its log file is
 * the console, so every line starts with the local date and time, and a
 * crash is one line — the error's name and code, never its message nor its
 * stack, which print the home folder's path and may quote data (the rule of
 * connect.ts, kept for crashes too). Installed by console-stamp-install.ts,
 * which run.sh loads with NODE_OPTIONS: a program run by hand prints as before.
 */
import { errorText } from "./error-text.ts";

const two = (n: number) => String(n).padStart(2, "0");

/** `2026-11-13 12:59:36`, in the machine's own time zone. */
export function stamp(at: Date): string {
  return (
    `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
    `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
  );
}

/** The line a crash leaves in the log: what failed, never what it said. */
export function crashLine(error: unknown): string {
  return `💥 plantage : ${errorText(error)} — le programme s'arrête, launchd le relance`;
}

type Write = (...args: unknown[]) => void;
export interface StampTarget {
  debug: Write;
  trace: Write;
  log: Write;
  info: Write;
  warn: Write;
  error: Write;
}
export interface CrashHooks {
  on(
    event: "uncaughtException" | "unhandledRejection",
    listener: (error: unknown) => void,
  ): unknown;
  exit(code: number): never;
}

const INSTALLED = Symbol.for("cenacle.console-stamp");

/**
 * Prefixes every console line with the time, and turns a crash into one line
 * then exit 1 (launchd restarts a program that fails). Installing twice does
 * nothing more.
 */
export function installConsoleStamp(
  target: StampTarget,
  hooks: CrashHooks,
  now: () => Date = () => new Date(),
): void {
  const marked = target as StampTarget & { [INSTALLED]?: true };
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;
  for (const level of ["debug", "trace", "log", "info", "warn", "error"] as const) {
    const write = target[level].bind(target);
    target[level] = (...args: unknown[]) => write(stamp(now()), ...args);
  }
  const crash = (error: unknown) => {
    try {
      target.error(crashLine(error));
    } finally {
      hooks.exit(1);
    }
  };
  hooks.on("uncaughtException", crash);
  hooks.on("unhandledRejection", crash);
}
