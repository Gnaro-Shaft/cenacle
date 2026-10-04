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

export const SECRET_FAMILIES = {
  /** The database owner: migrations and tests only. */
  owner: { file: ".env.owner", vars: ["CENACLE_DB_OWNER_PASSWORD"] },
  /** The mailbox password and the HMAC key of addresses. */
  mail: { file: ".env.mail", vars: ["CENACLE_TEST_MAIL_PASSWORD", "CENACLE_MAIL_KEY"] },
  telegram: { file: ".env.telegram", vars: ["TELEGRAM_BOT_TOKEN"] },
  /** Grafana's admin, for Docker Compose only. */
  obs: { file: ".env.obs", vars: ["GRAFANA_ADMIN_PASSWORD"] },
  /** The page's signing key (B6). */
  page: { file: ".env.page", vars: [PRIVATE_KEY_VAR] },
  /** The executor's database role (B7). */
  executor: { file: ".env.executor", vars: ["CENACLE_DB_EXECUTOR_PASSWORD"] },
} as const;

export type SecretFamily = keyof typeof SECRET_FAMILIES;
export const FAMILIES = Object.keys(SECRET_FAMILIES) as SecretFamily[];

export class SecretPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretPlacementError";
  }
}

/** The family a variable belongs to, or null when it is not a secret. */
export function familyOf(name: string): SecretFamily | null {
  for (const family of FAMILIES) {
    if ((SECRET_FAMILIES[family].vars as readonly string[]).includes(name)) return family;
  }
  return null;
}

/** Refuses to start when the environment holds a secret of a family not given to this program. */
export function refuseForeignSecrets(
  program: string,
  allowed: readonly SecretFamily[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const foreign = FAMILIES.filter((f) => !allowed.includes(f)).flatMap((f) =>
    SECRET_FAMILIES[f].vars.filter((v) => (env[v] ?? "") !== ""),
  );
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
