/**
 * The CERT-FR's security bulletins (J6e3, ADR-0025): its alerts (actively
 * exploited flaws) and its advisories, kept only when their title names a
 * software of my list, as a whole word. A bulletin is outside text: its title
 * is cleaned and capped, never shown when it reads like an order, and its
 * link kept only in the CERT-FR's exact form — on its old host or its new
 * one (cert.cyber.gouv.fr since October 2026), the finding's link always on
 * the new one. An alert speaks at once (high);
 * an advisory (medium) waits for the morning report, and closes quietly once out of
 * the feed (lifecycle.ts). Pure.
 */
import { parse } from "smol-toml";
import { advisoryText } from "./parse-npm.ts";
import type { Observation } from "./types.ts";

export type BulletinKind = "alerte" | "avis";

/** Where the CERT-FR lives since October 2026; the old host redirects here. */
export const CERTFR_HOST = "cert.cyber.gouv.fr";
export const BULLETIN_FEEDS: Readonly<Record<BulletinKind, string>> = {
  alerte: `https://${CERTFR_HOST}/alerte/feed/`,
  avis: `https://${CERTFR_HOST}/avis/feed/`,
};
/** An alert is followed for a year; an advisory for a week. */
export const BULLETIN_DAYS: Readonly<Record<BulletinKind, number>> = { alerte: 365, avis: 7 };
export const bulletinCheck = (kind: BulletinKind) =>
  kind === "alerte" ? "certfr_alertes" : "certfr_avis";

const DAY_MS = 86_400_000;
/** The feed reader drops the trailing slash; the identifier is what counts. */
const LINK =
  /^https:\/\/(?:www\.cert\.ssi\.gouv\.fr|cert\.cyber\.gouv\.fr)\/(alerte|avis)\/(CERTFR-\d{4}-(?:ALE|AVI)-\d{1,5})\/?$/;

/**
 * How many items of a feed carry a link of this kind in the CERT-FR's form.
 * None at all in a feed that has items: its form changed, and the check could
 * not run — never a silent "nothing found".
 */
export function recognizedLinks(items: readonly BulletinItem[], kind: BulletinKind): number {
  return items.filter((item) => LINK.exec(item.link)?.[1] === kind).length;
}
const SOFTWARE = /^[A-Za-z0-9][A-Za-z0-9 .+#-]{0,39}$/;
const MAX_SOFTWARE = 60;

export class BulletinConfigError extends Error {
  constructor(message: string) {
    super(`[bulletins]: ${message}`);
    this.name = "BulletinConfigError";
  }
}

/** `[bulletins] logiciels = [...]` of one TOML file; no table, no software. */
export function parseBulletinSoftware(text: string): string[] {
  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch {
    throw new BulletinConfigError("not valid TOML");
  }
  const table = data.bulletins;
  if (table === undefined) return [];
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new BulletinConfigError("must be a table");
  }
  const keys = Object.keys(table);
  if (keys.some((k) => k !== "logiciels")) throw new BulletinConfigError("only logiciels");
  const list = (table as { logiciels?: unknown }).logiciels ?? [];
  if (!Array.isArray(list) || list.length > MAX_SOFTWARE) {
    throw new BulletinConfigError(`logiciels: a list of ${MAX_SOFTWARE} names at most`);
  }
  for (const name of list) {
    if (typeof name !== "string" || !SOFTWARE.test(name)) {
      throw new BulletinConfigError("logiciels: plain names (letters, digits, . + # -)");
    }
  }
  return list as string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first software of the list the title names as a whole word ("Node.js", not "Nodemailer"). */
export function matchSoftware(title: string, software: readonly string[]): string | null {
  for (const name of software) {
    const word = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu");
    if (word.test(title)) return name;
  }
  return null;
}

export interface BulletinItem {
  readonly title: string;
  readonly link: string;
  readonly publishedAt: number;
}

export function bulletinObservations(
  items: readonly BulletinItem[],
  kind: BulletinKind,
  software: readonly string[],
  now: number,
): Observation[] {
  const out = new Map<string, Observation>();
  for (const item of items) {
    const m = LINK.exec(item.link);
    if (m === null || m[1] !== kind || m[2] === undefined) continue;
    const id = m[2];
    if (item.publishedAt < now - BULLETIN_DAYS[kind] * DAY_MS) continue;
    // Closed by the CERT-FR: no longer followed; its absence resolves the finding.
    if (/^\s*\[clos/i.test(item.title)) continue;
    const name = matchSoftware(item.title, software);
    if (name === null) continue;
    const words = advisoryText(item.title);
    out.set(id, {
      type: kind === "alerte" ? "bulletin_alerte" : "bulletin_avis",
      target: id,
      occurrence: "-",
      severity: kind === "alerte" ? "eleve" : "moyen",
      title: `CERT-FR, ${kind === "alerte" ? "alerte" : "avis"} ${id} (${name}) : ${
        words ?? "texte du bulletin non affiché"
      }`,
      params: { id, kind, software: name, url: `https://${CERTFR_HOST}/${kind}/${id}/` },
    });
  }
  return [...out.values()];
}
