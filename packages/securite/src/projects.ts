/**
 * My other projects (J6e2, ADR-0025): the list I keep in securite.local.toml
 * (git-ignored: it holds paths of my machine), and what the security agent
 * makes of an audit in one of them. Read-only: the agent audits, never
 * changes a project; there is no 🔧 here (the finding types differ from
 * Cénacle's own, so preparedFix never matches them). A finding names the
 * project, never its path.
 */
import { isAbsolute, normalize } from "node:path";
import { parse } from "smol-toml";
import { parseNpmAudit } from "./parse-npm.ts";
import type { Observation } from "./types.ts";

/** Lowercase letters and _: the name becomes part of a check name (^[a-z_]{1,40}$). */
export const PROJECT_NAME = /^[a-z][a-z_]{0,29}$/;
export const MAX_PROJECTS = 30;

export interface Project {
  readonly name: string;
  readonly path: string;
  /** npm audit on its lock file (the dependency list goes to the npm registry). */
  readonly npm: boolean;
  /** gitleaks on its git history, on the Mac. */
  readonly secrets: boolean;
}

export class ProjectsConfigError extends Error {
  constructor(message: string) {
    super(`securite.local.toml: ${message}`);
    this.name = "ProjectsConfigError";
  }
}

const KEYS = new Set(["nom", "chemin", "npm", "secrets"]);
const RESERVED = new Set(["audit", "outdated"]);

/** The projects of securite.local.toml; anything doubtful refuses the whole file. */
export function parseProjects(text: string): Project[] {
  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch {
    throw new ProjectsConfigError("not valid TOML");
  }
  const extra = Object.keys(data).filter((k) => k !== "projet");
  if (extra.length > 0) throw new ProjectsConfigError("only [[projet]] tables are expected");
  const list = data.projet ?? [];
  if (!Array.isArray(list)) throw new ProjectsConfigError("projet must be [[projet]] tables");
  if (list.length > MAX_PROJECTS) throw new ProjectsConfigError(`at most ${MAX_PROJECTS} projects`);
  const names = new Set<string>();
  return list.map((raw, i): Project => {
    const at = `projet n°${i + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ProjectsConfigError(`${at} is not a table`);
    }
    const p = raw as Record<string, unknown>;
    const unknown = Object.keys(p).filter((k) => !KEYS.has(k));
    if (unknown.length > 0) throw new ProjectsConfigError(`${at}: unknown key`);
    const { nom, chemin, npm, secrets } = p;
    if (typeof nom !== "string" || !PROJECT_NAME.test(nom)) {
      throw new ProjectsConfigError(`${at}: nom must be lowercase letters and _ (30 at most)`);
    }
    // npm_audit and npm_outdated are Cénacle's own checks.
    if (RESERVED.has(nom)) throw new ProjectsConfigError(`${at}: nom ${nom} is reserved`);
    if (names.has(nom)) throw new ProjectsConfigError(`${at}: nom ${nom} twice`);
    names.add(nom);
    if (
      typeof chemin !== "string" ||
      !isAbsolute(chemin) ||
      chemin.length > 300 ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters
      /[\u0000-\u001f\u007f]/.test(chemin) ||
      chemin.split("/").includes("..") ||
      normalize(chemin).replace(/\/+$/, "") !== chemin.replace(/\/+$/, "")
    ) {
      throw new ProjectsConfigError(`${at}: chemin must be a plain absolute path`);
    }
    if (typeof npm !== "boolean" || typeof secrets !== "boolean") {
      throw new ProjectsConfigError(`${at}: npm and secrets must be true or false`);
    }
    if (!npm && !secrets) throw new ProjectsConfigError(`${at}: nothing to check`);
    return { name: nom, path: chemin.replace(/\/+$/, "") || "/", npm, secrets };
  });
}

/** The check names of a project: one per check, so one project down closes nothing elsewhere. */
export const npmCheck = (name: string) => `npm_${name}`;
export const secretsCheck = (name: string) => `fuites_${name}`;
/** The list itself: when it cannot be read, no project is checked, and that is a finding. */
export const PROJECTS_CHECK = "projets";

/** npm audit in another project: the same advisories, named after the project, no 🔧. */
export function parseProjectNpmAudit(raw: string, project: string): Observation[] {
  return parseNpmAudit(raw)
    .filter((o) => o.target.length + project.length < 120)
    .map((o) => ({
      ...o,
      type: "projet_npm",
      target: `${project}/${o.target}`,
      title: `Projet ${project} : ${o.title.charAt(0).toLowerCase()}${o.title.slice(1)}`,
      params: { ...o.params, project },
    }));
}
