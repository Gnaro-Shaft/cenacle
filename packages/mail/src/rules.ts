/**
 * Sorting by rules: an exact sender domain decides the category. No model.
 *
 * Rules live in regles.local.toml (git-ignored: real domains are personal and
 * business data). Without it, regles.example.toml — the fictional test
 * domains — is used, and the caller says so out loud.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category } from "@cenacle/core";
import { parse } from "smol-toml";
import type { MailRef } from "./postman.ts";
import { senderDomain } from "./sender-domain.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
export const LOCAL_RULES_PATH = join(ROOT, "regles.local.toml");
export const EXAMPLE_RULES_PATH = join(ROOT, "regles.example.toml");

/** Categories a rule may give. "a_trier" is not one: a rule is a certainty. */
export const RULE_CATEGORIES = ["clients_prospects", "administratif", "bruit"] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export const MAX_RULES = 10_000;

export type Rules = ReadonlyMap<string, RuleCategory>;

export class RulesError extends Error {
  constructor(message: string) {
    super(`rules: ${message}`);
    this.name = "RulesError";
  }
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleCategory(value: string): value is RuleCategory {
  return (RULE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Domains that never expect a reply by mail (platform notifications): their
 * mails are sorted as usual, but no follow-up is ever due for them.
 */
export const NO_FOLLOW_UP_SECTION = "sans_suivi";

function validDomains(section: unknown, where: string): string[] {
  if (!isTable(section)) throw new RulesError(`[${where}] must be a section`);
  for (const key of Object.keys(section)) {
    if (key !== "domains") throw new RulesError(`unknown key "${key}" in [${where}]`);
  }
  const domains = section.domains;
  if (!Array.isArray(domains)) throw new RulesError(`[${where}] domains must be a list`);
  for (const domain of domains) {
    // Same strict reading as a received From header: lowercase, valid labels, no wildcard.
    if (typeof domain !== "string" || senderDomain(`x@${domain}`) !== domain) {
      throw new RulesError(`invalid domain ${JSON.stringify(domain)} in [${where}]`);
    }
  }
  return domains as string[];
}

export function toNoFollowUp(raw: unknown): ReadonlySet<string> {
  if (!isTable(raw) || raw[NO_FOLLOW_UP_SECTION] === undefined) return new Set();
  return new Set(validDomains(raw[NO_FOLLOW_UP_SECTION], NO_FOLLOW_UP_SECTION));
}

/** Validates already-parsed TOML. Exported for tests. */
export function toRules(raw: unknown): Rules {
  if (!isTable(raw)) throw new RulesError("not a table");
  const rules = new Map<string, RuleCategory>();
  for (const [category, section] of Object.entries(raw)) {
    if (category === NO_FOLLOW_UP_SECTION) {
      toNoFollowUp(raw); // validated here too, read by toNoFollowUp
      continue;
    }
    if (!isRuleCategory(category)) {
      throw new RulesError(
        `unknown category "${category}" (allowed: ${RULE_CATEGORIES.join(", ")})`,
      );
    }
    for (const domain of validDomains(section, category)) {
      const already = rules.get(domain);
      if (already !== undefined) {
        throw new RulesError(`"${domain}" is in both [${already}] and [${category}]`);
      }
      rules.set(domain, category);
      if (rules.size > MAX_RULES) throw new RulesError(`more than ${MAX_RULES} domains`);
    }
  }
  return rules;
}

function parseToml(source: string): unknown {
  try {
    return parse(source);
  } catch (error) {
    throw new RulesError(`invalid TOML (${error instanceof Error ? error.message : error})`);
  }
}

export function parseRules(source: string): Rules {
  return toRules(parseToml(source));
}

export interface LoadedRules {
  readonly rules: Rules;
  /** Domains whose mails never get a follow-up ([sans_suivi]). */
  readonly noFollowUp: ReadonlySet<string>;
  /** True when no regles.local.toml exists and the fictional example is used. */
  readonly example: boolean;
}

export function loadRules(
  paths = { local: LOCAL_RULES_PATH, example: EXAMPLE_RULES_PATH },
): LoadedRules {
  const example = !existsSync(paths.local);
  const raw = parseToml(readFileSync(example ? paths.example : paths.local, "utf8"));
  return { rules: toRules(raw), noFollowUp: toNoFollowUp(raw), example };
}

export interface SortedRef {
  readonly uid: number;
  readonly category: Category;
  /** "rule" for an exact domain rule, "unreadable" when the sender could not be read. */
  readonly decidedBy: "rule" | "unreadable";
}

export interface RuleSort<T extends Sortable = MailRef> {
  /** Decided without a model: by an exact rule, or "a_trier" for an unreadable sender. */
  readonly sorted: readonly SortedRef[];
  /** Domains no rule knows: left for the model. */
  readonly remaining: readonly T[];
  readonly counts: Readonly<Record<Category, number>> & { readonly remaining: number };
}

/** What sorting by rules needs to know of a mail. */
export interface Sortable {
  readonly uid: number;
  readonly domain: string | null;
}

export function sortByRules<T extends Sortable>(refs: readonly T[], rules: Rules): RuleSort<T> {
  const sorted: SortedRef[] = [];
  const remaining: T[] = [];
  const counts = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, remaining: 0 };
  for (const ref of refs) {
    const category: Category | undefined = ref.domain === null ? "a_trier" : rules.get(ref.domain);
    if (category === undefined) {
      remaining.push(ref);
      counts.remaining++;
    } else {
      sorted.push({
        uid: ref.uid,
        category,
        decidedBy: ref.domain === null ? "unreadable" : "rule",
      });
      counts[category]++;
    }
  }
  return { sorted, remaining, counts };
}
