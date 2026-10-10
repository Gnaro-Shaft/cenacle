/**
 * What the veille reads and for whom (J5, ADR-0024). `veille.toml` (versioned:
 * public feeds and settings only) names the sources; `veille.local.toml`
 * (git-ignored: the names and nature of my projects are mine) maps the
 * projects an article may serve. Without it, `veille.example.toml` and its
 * fictional projects. Everything is checked here: a source is https, a name
 * is short, a project is named once.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface Source {
  readonly nom: string;
  readonly url: string;
  /** "actualite" (news) or "version" (release notes of a tool I use). */
  readonly theme: "actualite" | "version";
}

export interface Project {
  readonly nom: string;
  readonly resume: string;
  readonly pile: readonly string[];
}

export interface VeilleSettings {
  /** Articles published within this many hours. */
  readonly fenetreHeures: number;
  /** At most this many articles go to the model. */
  readonly maxArticles: number;
  /** …and at most this many from one source: a busy feed must not crowd out the others. */
  readonly maxParSource: number;
  /** Kept from this score (1-10)… */
  readonly seuil: number;
  /** …and at most this many in the message. */
  readonly maxRetenus: number;
  /** How long a sent article stays in the archive (and is never sent again). */
  readonly veilleJours: number;
  /** Who I am, in one or two sentences: what "useful" means. */
  readonly profil: string;
}

export interface VeilleConfig {
  readonly settings: VeilleSettings;
  readonly sources: readonly Source[];
  readonly projects: readonly Project[];
  /** Whether the projects came from the fictional example. */
  readonly exampleProjects: boolean;
}

export class VeilleConfigError extends Error {
  constructor(message: string) {
    super(`veille: ${message}`);
    this.name = "VeilleConfigError";
  }
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function text(t: Record<string, unknown>, key: string, where: string, max: number): string {
  const v = t[key];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) {
    throw new VeilleConfigError(`${where}.${key} must be a text of 1 to ${max} characters`);
  }
  return v.trim();
}

function int(t: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = t[key];
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new VeilleConfigError(`reglage.${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function source(raw: unknown, i: number): Source {
  if (!isTable(raw)) throw new VeilleConfigError(`source ${i + 1} is not a table`);
  const where = `source ${i + 1}`;
  const url = text(raw, "url", where, 300);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VeilleConfigError(`${where}.url is not a URL`);
  }
  // Read in clear over the network, a feed could be altered on its way.
  if (parsed.protocol !== "https:") throw new VeilleConfigError(`${where}.url must be https`);
  const theme = raw.theme;
  if (theme !== "actualite" && theme !== "version") {
    throw new VeilleConfigError(`${where}.theme must be "actualite" or "version"`);
  }
  return { nom: text(raw, "nom", where, 60), url, theme };
}

function project(raw: unknown, i: number): Project {
  if (!isTable(raw)) throw new VeilleConfigError(`projet ${i + 1} is not a table`);
  const where = `projet ${i + 1}`;
  const pile = raw.pile;
  if (!Array.isArray(pile) || pile.length === 0 || pile.length > 30) {
    throw new VeilleConfigError(`${where}.pile must list 1 to 30 technologies`);
  }
  return {
    nom: text(raw, "nom", where, 40),
    resume: text(raw, "resume", where, 200),
    pile: pile.map((p, j) => text({ p }, "p", `${where}.pile[${j}]`, 40)),
  };
}

export function parseSources(source_: string): {
  settings: VeilleSettings;
  sources: Source[];
} {
  const raw = parse(source_);
  const r = raw.reglage;
  if (!isTable(r)) throw new VeilleConfigError("missing [reglage]");
  const settings = {
    fenetreHeures: int(r, "fenetre_heures", 1, 168),
    maxArticles: int(r, "max_articles", 1, 80),
    maxParSource: int(r, "max_par_source", 1, 80),
    seuil: int(r, "seuil", 1, 10),
    maxRetenus: int(r, "max_retenus", 1, 20),
    veilleJours: int(r, "veille_jours", 7, 730),
    profil: text(r, "profil", "reglage", 400),
  };
  if (!Array.isArray(raw.source) || raw.source.length === 0) {
    throw new VeilleConfigError("no [[source]]");
  }
  const sources = raw.source.map(source);
  const names = new Set<string>();
  for (const s of sources) {
    if (names.has(s.nom)) throw new VeilleConfigError(`source "${s.nom}" declared twice`);
    names.add(s.nom);
  }
  return { settings, sources };
}

export function parseProjects(source_: string): Project[] {
  const raw = parse(source_);
  if (!Array.isArray(raw.projet) || raw.projet.length === 0 || raw.projet.length > 40) {
    throw new VeilleConfigError("1 to 40 [[projet]] expected");
  }
  const projects = raw.projet.map(project);
  const names = new Set<string>();
  for (const p of projects) {
    const key = p.nom.toLowerCase();
    if (names.has(key)) throw new VeilleConfigError(`projet "${p.nom}" declared twice`);
    names.add(key);
  }
  return projects;
}

/** Reads `veille.toml`, then `veille.local.toml` or else the fictional example. */
export function loadVeilleConfig(root: string): VeilleConfig {
  const { settings, sources } = parseSources(readFileSync(join(root, "veille.toml"), "utf8"));
  const local = join(root, "veille.local.toml");
  const exampleProjects = !existsSync(local);
  const projects = parseProjects(
    readFileSync(exampleProjects ? join(root, "veille.example.toml") : local, "utf8"),
  );
  return { settings, sources, projects, exampleProjects };
}
