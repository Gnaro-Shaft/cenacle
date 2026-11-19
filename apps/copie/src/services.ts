/**
 * The services that write the four tables, stopped while they are reloaded
 * (ADR-0044, point 7): launchd would start them again by itself, so they are
 * booted out — each one loaded, and only those — then bootstrapped again from
 * their own plist, whatever happened. The bot (reminders, decisions), the
 * page's server (cards, decisions), the security agent, the veille, the
 * prospection agent and the operator (its actions point at the findings).
 */
import { join } from "node:path";
import { CopieError } from "./export.ts";

export const WRITERS = ["bot", "server", "securite", "veille", "prospection", "operateur"] as const;

export type Launchctl = (args: readonly string[]) => Promise<{ code: number; output: string }>;

export interface ServiceDeps {
  readonly launchctl: Launchctl;
  readonly uid: number;
  readonly home: string;
  /** Waits between two looks at a job still stopping. */
  readonly pause: (ms: number) => Promise<void>;
}

const label = (program: string) => `org.cenacle.${program}`;
const target = (deps: ServiceDeps, program: string) => `gui/${deps.uid}/${label(program)}`;
/** launchd's own stop timeout, and some: a job still there after it is not stopping. */
const STOP_LOOKS = 50;
const LOOK_MS = 1000;

async function loaded(deps: ServiceDeps, program: string): Promise<boolean> {
  return (await deps.launchctl(["print", target(deps, program)])).code === 0;
}

/** Starts again the services stopped; returns those that did not start. */
export async function resumeWriters(deps: ServiceDeps, stopped: readonly string[]) {
  const failed: string[] = [];
  for (const program of stopped) {
    const plist = join(deps.home, "Library", "LaunchAgents", `${label(program)}.plist`);
    const run = await deps.launchctl(["bootstrap", `gui/${deps.uid}`, plist]);
    if (run.code !== 0) failed.push(program);
  }
  return failed;
}

/**
 * Stops each loaded writer and waits until launchd no longer knows it.
 * Returns those stopped; if one will not stop, starts the others again and throws.
 */
export async function stopWriters(deps: ServiceDeps): Promise<string[]> {
  const stopped: string[] = [];
  for (const program of WRITERS) {
    if (!(await loaded(deps, program))) continue;
    await deps.launchctl(["bootout", target(deps, program)]);
    let looks = 0;
    while (await loaded(deps, program)) {
      if (++looks > STOP_LOOKS) {
        const failed = await resumeWriters(deps, stopped);
        const tail = failed.length > 0 ? ` ; ne repartent pas : ${failed.join(", ")}` : "";
        throw new CopieError(`${program} ne s'arrête pas : rien n'est restauré${tail}`);
      }
      await deps.pause(LOOK_MS);
    }
    stopped.push(program);
  }
  return stopped;
}
