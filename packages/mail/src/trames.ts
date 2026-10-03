/**
 * Reply templates (« trames », phase 4, B0b): my words, with slots.
 *
 * Iris picks one template from a closed list and fills its slots; she never
 * writes the text around them. Three kinds of slots, fixed by code:
 * - "code": filled by code from the mail ({prenom}, {objet});
 * - "thread": taken from the conversation by Iris, then fact-checked;
 * - "owner": left for me — shown in red, never invented ({delai}…).
 * No personal data in the repository: my templates and signature live in
 * trames.local.toml (git-ignored); trames.example.toml is the public example.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDraft } from "@cenacle/core";
import { parse } from "smol-toml";

const ROOT = join(import.meta.dirname, "..", "..", "..");
export const LOCAL_TRAMES_PATH = join(ROOT, "trames.local.toml");
export const EXAMPLE_TRAMES_PATH = join(ROOT, "trames.example.toml");

export const SLOT_KINDS = {
  prenom: "code",
  objet: "code",
  date: "thread",
  creneau: "thread",
  sujet: "thread",
  delai: "owner",
  creneau_propose: "owner",
  precision: "owner",
} as const;
export type Slot = keyof typeof SLOT_KINDS;

export interface Trame {
  readonly id: string;
  readonly titre: string;
  readonly quand: string;
  readonly texte: string;
  readonly slots: readonly Slot[];
}

export interface Trames {
  readonly trames: ReadonlyMap<string, Trame>;
  readonly signature: string;
  /** True when no trames.local.toml exists and the public example is used. */
  readonly example: boolean;
}

export class TrameError extends Error {
  constructor(message: string) {
    super(`trames: ${message}`);
    this.name = "TrameError";
  }
}

const ID_RULE = /^[a-z][a-z0-9_]{1,40}$/;
const SLOT_RULE = /\{([^{}]*)\}/g;
const MAX_TEXT = 2000;
const MAX_SLOT_VALUE = 80;

function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(table: Record<string, unknown>, key: string, where: string, max: number): string {
  const v = table[key];
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
    throw new TrameError(`${where}.${key} must be a non-empty text of at most ${max} characters`);
  }
  return v.trim();
}

function only(table: Record<string, unknown>, keys: readonly string[], where: string) {
  for (const k of Object.keys(table))
    if (!keys.includes(k)) throw new TrameError(`unknown key "${k}" in ${where}`);
}

export function slotsOf(texte: string, where = "trame"): Slot[] {
  const slots: Slot[] = [];
  for (const m of texte.matchAll(SLOT_RULE)) {
    const name = m[1] ?? "";
    if (!(name in SLOT_KINDS)) throw new TrameError(`unknown slot {${name}} in ${where}`);
    if (!slots.includes(name as Slot)) slots.push(name as Slot);
  }
  // Unbalanced braces would let a value open a slot: refused.
  if (texte.replace(SLOT_RULE, "").match(/[{}]/)) throw new TrameError(`stray brace in ${where}`);
  return slots;
}

export function parseTrames(source: string, example = false): Trames {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new TrameError(`invalid TOML (${error instanceof Error ? error.message : error})`);
  }
  if (!isTable(raw)) throw new TrameError("not a table");
  only(raw, ["signature", "trames"], "the file");
  if (!isTable(raw.signature)) throw new TrameError("missing [signature]");
  only(raw.signature, ["texte"], "[signature]");
  const signature = text(raw.signature, "texte", "signature", 300);
  slotsOf(signature, "signature");
  if (/\{/.test(signature)) throw new TrameError("the signature has no slot");
  if (!isTable(raw.trames)) throw new TrameError("missing [trames.*]");
  const trames = new Map<string, Trame>();
  for (const [id, t] of Object.entries(raw.trames)) {
    if (!ID_RULE.test(id)) throw new TrameError(`invalid trame id "${id}"`);
    if (!isTable(t)) throw new TrameError(`[trames.${id}] must be a section`);
    only(t, ["titre", "quand", "texte"], `[trames.${id}]`);
    const texte = text(t, "texte", id, MAX_TEXT);
    trames.set(id, {
      id,
      titre: text(t, "titre", id, 100),
      quand: text(t, "quand", id, 300),
      texte,
      slots: slotsOf(texte, id),
    });
  }
  if (trames.size === 0) throw new TrameError("no trame");
  return { trames, signature, example };
}

export function loadTrames(
  paths = { local: LOCAL_TRAMES_PATH, example: EXAMPLE_TRAMES_PATH },
): Trames {
  const example = !existsSync(paths.local);
  return parseTrames(readFileSync(example ? paths.example : paths.local, "utf8"), example);
}

/** {prenom}: the first word of the sender's display name, if it looks like a first name. */
export function firstName(displayName: string): string | null {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  return /^\p{Lu}[\p{L}'-]{1,30}$/u.test(first) ? first : null;
}

export type SlotValues = Partial<Record<Slot, string>>;

export interface Rendered {
  readonly text: string;
  /** Slots left for me (owner slots, and any slot that could not be filled safely). */
  readonly toComplete: readonly Slot[];
  /** Thread slots refused because their value states a fact absent from the conversation. */
  readonly refused: readonly Slot[];
}

/** Marks a slot left for me: visible, in the text, never a guess. */
export const missing = (slot: Slot) => `{${slot} ?}`;

/**
 * Fills a trame. `values` come from code ({prenom}, {objet}) and from Iris
 * (thread slots); owner slots are always left for me. Every thread value is
 * bounded, single-line, and fact-checked against the conversation.
 */
export function renderTrame(
  trame: Trame,
  values: SlotValues,
  conversation: readonly string[],
  signature: string,
): Rendered {
  const toComplete: Slot[] = [];
  const refused: Slot[] = [];
  const filled = new Map<Slot, string>();
  for (const slot of trame.slots) {
    const value = values[slot]?.trim();
    const kind = SLOT_KINDS[slot];
    const safe =
      value !== undefined &&
      value.length > 0 &&
      value.length <= MAX_SLOT_VALUE &&
      !/[\r\n{}<>]/.test(value) &&
      !/https?:|@/.test(value);
    if (kind === "owner" || !safe) {
      toComplete.push(slot);
      continue;
    }
    if (kind === "thread" && !checkDraft(value, conversation).ok) {
      refused.push(slot);
      toComplete.push(slot);
      continue;
    }
    filled.set(slot, value);
  }
  const body = trame.texte.replace(
    SLOT_RULE,
    (_m, name: string) => filled.get(name as Slot) ?? missing(name as Slot),
  );
  // A value at the start of a sentence gets a capital ("vendredi à 10 h" → "Vendredi à 10 h").
  const text = `${body.replace(/(^|\n)(\p{Ll})/gu, (_m, start: string, c: string) => start + c.toUpperCase())}\n\n${signature}`;
  return { text, toComplete, refused };
}
