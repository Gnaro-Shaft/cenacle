/**
 * A mission I spotted myself, typed on the page (ADR-0032, point 16): the
 * same closed fields and the same cleaning as an extracted one, plus a short
 * note; the same rules, without the model — I filled the fields. Never a
 * pasted post: only fields are kept. And which link the page may make
 * clickable (point 19): https only, and for a mail's card, a declared host.
 */
import { type ProspectionConfig, REMOTE_VALUES, type Remote } from "./config.ts";
import { INTERMEDIARIES, type Intermediary, type Offer } from "./extract.ts";
import { cleanField, cleanStackWord } from "./text.ts";
import { type AgentColumn, type Decider, triage } from "./triage.ts";

export const NOTE_MAX = 280;

export interface HandCard extends Offer {
  readonly note: string | null;
  readonly column: AgentColumn;
  readonly reason: string | null;
  readonly decidedBy: Decider;
  readonly toCheck: boolean;
}

export type HandResult =
  | { readonly ok: true; readonly card: HandCard }
  | { readonly ok: false; readonly error: string };

type Input = Record<string, unknown>;
const isInput = (v: unknown): v is Input =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const FIELDS = [
  "intitule",
  "entreprise",
  "intermediaire",
  "stack",
  "tjm",
  "teletravail",
  "lieu",
  "lien",
  "note",
];

/**
 * An https address, written exactly as the base requires it (lowercase scheme,
 * two slashes, a host), without blanks or quotes. "HTTPS:/x" is refused: a URL
 * parser would repair it, the base would not.
 */
export function httpsLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  if (!/^https:\/\/[^\s"'<>/?#]+[^\s"'<>]*$/.test(value)) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return cleanField(value, max) ?? undefined;
}

function rate(value: unknown): readonly [number, number] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [min, max] = value;
  const ok = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) > 0 && (n as number) <= 5000;
  return ok(min) && ok(max) && min <= max ? [min, max] : undefined;
}

export function cardByHand(input: unknown, config: ProspectionConfig): HandResult {
  const fail = (error: string): HandResult => ({ ok: false, error });
  if (!isInput(input)) return fail("formulaire illisible");
  for (const key of Object.keys(input)) {
    if (!FIELDS.includes(key)) return fail(`champ inconnu : ${key.slice(0, 30)}`);
  }
  const title = cleanField(input.intitule, 120);
  if (title === null) return fail("l'intitulé est vide");
  const company = optionalText(input.entreprise, 80);
  const place = optionalText(input.lieu, 60);
  const note = optionalText(input.note, NOTE_MAX);
  if (company === undefined || place === undefined || note === undefined) {
    return fail("un texte ne contient rien d'utilisable");
  }
  if (!(INTERMEDIARIES as readonly unknown[]).includes(input.intermediaire)) {
    return fail("intermédiaire : esn, direct ou inconnu");
  }
  if (!(REMOTE_VALUES as readonly unknown[]).includes(input.teletravail)) {
    return fail("télétravail : total, partiel, aucun ou inconnu");
  }
  const stackIn = input.stack ?? [];
  if (!Array.isArray(stackIn) || stackIn.length > 10) return fail("stack : 10 mots au plus");
  const stack = stackIn.map(cleanStackWord);
  if (stack.some((w) => w === null)) return fail("stack : un mot n'est pas une technologie");
  const r = rate(input.tjm);
  if (r === undefined) return fail("TJM : deux entiers de 1 à 5000, le minimum d'abord");
  const link = input.lien === undefined || input.lien === "" ? null : httpsLink(input.lien);
  if (link === null && input.lien !== undefined && input.lien !== "") {
    return fail("lien : une adresse https seulement");
  }
  const offer: Offer = {
    title,
    company,
    intermediary: input.intermediaire as Intermediary,
    stack: [...new Set(stack as string[])],
    rate: r,
    remote: input.teletravail as Remote,
    place,
    link,
  };
  const t = triage(offer, config, "me");
  return {
    ok: true,
    card: {
      ...offer,
      note,
      column: t.column,
      reason: t.reason,
      decidedBy: t.decidedBy,
      toCheck: t.toCheck,
    },
  };
}

/**
 * The link the page may make clickable: https only; for a mail's card, only on
 * a host its platform declares today (a host removed since is no longer trusted).
 */
export function shownLink(
  card: {
    readonly source: "mail" | "me";
    readonly platform: string | null;
    readonly link: string | null;
  },
  config: ProspectionConfig,
): string | null {
  const link = httpsLink(card.link);
  if (link === null || card.source === "me") return link;
  const platform = config.platforms.find((p) => p.name === card.platform);
  return platform !== undefined && platform.linkHosts.has(new URL(link).hostname) ? link : null;
}
