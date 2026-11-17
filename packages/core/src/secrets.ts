/**
 * Which program may hold which secret (phase 5, S1 — ADR-0013, point 4).
 *
 * Each family of secrets lives in its own git-ignored file, loaded only by
 * the programs that need it. A program that finds a secret of a family it
 * was not given refuses to start: a misconfiguration is said, never silent.
 * The database owner's password matters most: whoever holds it can disable
 * every guarantee the database holds (triggers, roles). Only the migrations
 * and the tests may.
 */
import { PRIVATE_KEY_VAR } from "./acceptance.ts";
import { CONFIRM_PRIVATE_KEY_VAR } from "./confirmation.ts";

/**
 * The agenda's application passwords (ADR-0042): one per account, named after
 * it (CENACLE_AGENDA_MOT_DE_PASSE_PRO…), so the family is known by this prefix.
 */
export const AGENDA_PASSWORD_PREFIX = "CENACLE_AGENDA_MOT_DE_PASSE_";

/** The variable that holds an account's password: its name in capitals. */
export function agendaPasswordVar(account: string): string {
  return `${AGENDA_PASSWORD_PREFIX}${account.toUpperCase()}`;
}

export const SECRET_FAMILIES = {
  /** The database owner: migrations and tests only. */
  owner: { file: ".env.owner", vars: ["CENACLE_DB_OWNER_PASSWORD"] },
  /**
   * The database's superuser (ADR-0038): loaded by no program, not even the
   * migrations — Docker Compose reads it, and I use it by hand, rarely.
   */
  admin: { file: ".env.admin", vars: ["CENACLE_DB_ADMIN_PASSWORD"] },
  /** The mailbox password and the HMAC key of addresses. */
  mail: {
    file: ".env.mail",
    vars: ["CENACLE_TEST_MAIL_PASSWORD", "CENACLE_MAIL_PASSWORD", "CENACLE_MAIL_KEY"],
  },
  telegram: { file: ".env.telegram", vars: ["TELEGRAM_BOT_TOKEN"] },
  /** Grafana's admin, for Docker Compose only. */
  obs: { file: ".env.obs", vars: ["GRAFANA_ADMIN_PASSWORD"] },
  /** The page's signing key (B6). */
  page: { file: ".env.page", vars: [PRIVATE_KEY_VAR] },
  /** The bot's signing key: my confirmation of an action on a server (ADR-0036). */
  bot: { file: ".env.bot", vars: [CONFIRM_PRIVATE_KEY_VAR] },
  /** The Proxmox cluster's read-only token (ADR-0039): the page's server alone. */
  proxmox: { file: ".env.proxmox", vars: ["CENACLE_PROXMOX_TOKEN"] },
  /** The agenda's application passwords (ADR-0042): the page's server alone, by prefix. */
  agenda: { file: ".env.agenda", vars: [], prefix: AGENDA_PASSWORD_PREFIX },
  /** The executor's database role (B7). */
  executor: { file: ".env.executor", vars: ["CENACLE_DB_EXECUTOR_PASSWORD"] },
  /**
   * The nightly copy's database role (ADR-0044): read by the copy program and
   * the migrations that make the role (and the tests), by no other program.
   */
  copie: { file: ".env.copie", vars: ["CENACLE_DB_COPIE_PASSWORD"] },
  /**
   * Shared with the sentinel (S2): Iris, the executor, the security agent (J6e1)
   * and the bot, for the reminders' bell (ADR-0041), beat with it.
   */
  sentinel: { file: ".env.sentinel", vars: ["CENACLE_SENTINEL_TOKEN"] },
} as const;

export type SecretFamily = keyof typeof SECRET_FAMILIES;
export const FAMILIES = Object.keys(SECRET_FAMILIES) as SecretFamily[];

export class SecretPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretPlacementError";
  }
}

/** A family's prefix, when its variables are known by it rather than listed. */
function prefixOf(family: SecretFamily): string | null {
  const entry = SECRET_FAMILIES[family];
  return "prefix" in entry ? entry.prefix : null;
}

/** The family a variable belongs to, or null when it is not a secret. */
export function familyOf(name: string): SecretFamily | null {
  for (const family of FAMILIES) {
    if ((SECRET_FAMILIES[family].vars as readonly string[]).includes(name)) return family;
    const prefix = prefixOf(family);
    // The prefix alone names no account: it is not a password, but it is refused all the same.
    if (prefix !== null && name.startsWith(prefix)) return family;
  }
  return null;
}

/** Refuses to start when the environment holds a secret of a family not given to this program. */
export function refuseForeignSecrets(
  program: string,
  allowed: readonly SecretFamily[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const foreign = Object.keys(env)
    .filter((name) => (env[name] ?? "") !== "")
    .filter((name) => {
      const family = familyOf(name);
      return family !== null && !allowed.includes(family);
    })
    .sort();
  if (foreign.length > 0) {
    // Names only, never values.
    throw new SecretPlacementError(
      `${program} must not hold ${foreign.join(", ")} (ADR-0013): load only its own .env.* files`,
    );
  }
}

export interface SplitPlan {
  /** What stays in .env: comments, blank lines and non-secret variables, in order. */
  readonly remaining: readonly string[];
  /** Lines to write per secret family. */
  readonly moved: Readonly<Partial<Record<SecretFamily, readonly string[]>>>;
  /** Variable names moved, per file — what may be shown (never the values). */
  readonly summary: Readonly<Partial<Record<string, readonly string[]>>>;
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Splits the text of a .env: each secret line goes to its family's file, the rest stays. */
export function splitEnv(text: string): SplitPlan {
  const remaining: string[] = [];
  const moved: Partial<Record<SecretFamily, string[]>> = {};
  const summary: Partial<Record<string, string[]>> = {};
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const name = ASSIGNMENT.exec(line)?.[1];
    const family = name === undefined ? null : familyOf(name);
    if (name === undefined || family === null) {
      remaining.push(line);
      continue;
    }
    if (seen.has(name)) throw new SecretPlacementError(`${name} is defined twice in .env`);
    seen.add(name);
    moved[family] = [...(moved[family] ?? []), line.trim()];
    const file = SECRET_FAMILIES[family].file;
    summary[file] = [...(summary[file] ?? []), name];
  }
  return { remaining, moved, summary };
}
