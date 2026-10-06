/**
 * The sentinel's judgement (phase 5, S2 — ADR-0002). Pure: no clock, no
 * network. It sees no content, ever: a heartbeat says which program is alive
 * and when, nothing else, and anything else is refused.
 *
 * - When an expected program has been silent for longer than the limit, ONE
 *   alert names the silent programs; when they are all back, ONE message says
 *   so. An outage is told once, not every minute.
 * - A heartbeat dated in the future or too old is refused: a replayed or
 *   forged beat must not hide a dead Mac.
 * - Only the programs that should run are expected (SENTINEL_PROGRAMS): in M2
 *   the executor does not run on the real box, and its silence is no outage.
 */

export const PROGRAMS = ["iris", "executor"] as const;
export type Program = (typeof PROGRAMS)[number];

const LABEL: Readonly<Record<Program, string>> = { iris: "Iris", executor: "l'exécuteur" };

/** SENTINEL_PROGRAMS: a comma list of known programs, each once; all of them when absent. */
export function parsePrograms(raw: string | undefined): readonly Program[] {
  if (raw === undefined || raw.trim() === "") return PROGRAMS;
  const names = raw.split(",").map((n) => n.trim());
  for (const n of names) {
    if (!(PROGRAMS as readonly string[]).includes(n)) {
      throw new BeatError(`SENTINEL_PROGRAMS: unknown program ${JSON.stringify(n)}`);
    }
  }
  if (new Set(names).size !== names.length)
    throw new BeatError("SENTINEL_PROGRAMS: a program twice");
  return names as Program[];
}
/** A beat may be this old when it arrives (network delays), and this early (clock skew). */
const MAX_AGE_MS = 5 * 60_000;
const MAX_AHEAD_MS = 60_000;

export class BeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeatError";
  }
}

export interface Beat {
  readonly program: Program;
  readonly at: Date;
}

/** A heartbeat body: exactly { program, at }, nothing more — no room for content. */
export function parseBeat(body: unknown, now: Date): Beat {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BeatError("a heartbeat is an object");
  }
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes("program") || !keys.includes("at")) {
    throw new BeatError("a heartbeat holds exactly: program, at");
  }
  const { program, at } = body as { program: unknown; at: unknown };
  if (typeof program !== "string" || !(PROGRAMS as readonly string[]).includes(program)) {
    throw new BeatError("unknown program");
  }
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at)) {
    throw new BeatError("at must be an ISO UTC time");
  }
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new BeatError("at must be an ISO UTC time");
  if (when.getTime() > now.getTime() + MAX_AHEAD_MS) throw new BeatError("a beat from the future");
  if (when.getTime() < now.getTime() - MAX_AGE_MS) throw new BeatError("a beat too old");
  return { program: program as Program, at: when };
}

export interface Watch {
  beat(beat: Beat): void;
  /** What to tell now, if anything. Call `told` once it is sent. */
  check(now: Date): string | null;
  /** The message was delivered: the state it described is the one known. */
  told(): void;
}

export function createWatch(opts: {
  readonly silenceMs: number;
  readonly startedAt: Date;
  /** The programs that should run; all of them by default. */
  readonly programs?: readonly Program[];
}): Watch {
  const expected = opts.programs ?? PROGRAMS;
  if (expected.length === 0) throw new BeatError("the sentinel must expect at least one program");
  // Until a first beat, a program counts from the sentinel's start: a Mac that
  // never spoke is a Mac that is down.
  const last = new Map<Program, number>(expected.map((p) => [p, opts.startedAt.getTime()]));
  let toldSilent: readonly Program[] = [];
  let pending: readonly Program[] | null = null;

  return {
    beat({ program, at }) {
      const seen = last.get(program);
      // A program not expected (the executor in M2) is heard, and ignored.
      if (seen !== undefined && at.getTime() > seen) last.set(program, at.getTime());
    },
    check(now) {
      const silent = expected.filter((p) => now.getTime() - (last.get(p) ?? 0) > opts.silenceMs);
      const same =
        silent.length === toldSilent.length && silent.every((p) => toldSilent.includes(p));
      if (same) {
        pending = null;
        return null;
      }
      pending = silent;
      if (silent.length === 0) {
        const all = expected.map((p) => LABEL[p]).join(" et ");
        return `✅ Le Mac répond de nouveau : ${all} ${expected.length > 1 ? "battent" : "bat"}.`;
      }
      const minutes = Math.round(opts.silenceMs / 60_000);
      const names = silent.map((p) => LABEL[p]).join(" et ");
      return `🚨 Plus de nouvelles de ${names} depuis plus de ${minutes} min : le Mac est peut-être en panne.`;
    },
    told() {
      if (pending !== null) toldSilent = pending;
      pending = null;
    },
  };
}
