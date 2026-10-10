/**
 * Reading `npm audit --json` and `npm outdated --json` (J6a). An advisory's
 * text comes from outside: it is cleaned, capped, and when it reads like an
 * order ("run…", "curl…", "ignore…") it is not shown at all — the finding
 * says so instead (Legion: an instruction found in content is a finding,
 * never followed). Names and versions are checked before any use.
 */
import { plainOutput } from "./parse-mac.ts";
import { CheckOutputError, type Observation, type Severity } from "./types.ts";

export const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,100}\/)?[a-z0-9][a-z0-9._-]{0,100}$/;
export const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
const ADVISORY_URL = /^https:\/\/github\.com\/advisories\/GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const SUSPICIOUS =
  /\b(?:run|execute|exécute[rz]?|lance[rz]?|curl|wget|sudo|rm\s+-rf|ignore|disregard|bash|powershell|eval)\b|https?:\/\//i;

const SEVERITY: Readonly<Record<string, Severity>> = {
  info: "info",
  low: "faible",
  moderate: "moyen",
  high: "eleve",
  critical: "critique",
};

function json(raw: string, check: string): Record<string, unknown> {
  try {
    const data = JSON.parse(plainOutput(raw));
    if (typeof data === "object" && data !== null && !Array.isArray(data)) return data;
  } catch {
    // fall through
  }
  throw new CheckOutputError(check);
}

/** An advisory's own words, if they can be shown: short, plain, giving no order. */
export function advisoryText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  if (text === "" || SUSPICIOUS.test(text)) return null;
  return text;
}

export function parseNpmAudit(raw: string): Observation[] {
  const data = json(raw, "npm_audit");
  const vulns = data.vulnerabilities;
  if (typeof vulns !== "object" || vulns === null) throw new CheckOutputError("npm_audit");
  const out: Observation[] = [];
  for (const [pkg, v] of Object.entries(vulns as Record<string, unknown>).slice(0, 500)) {
    if (!NPM_NAME.test(pkg) || typeof v !== "object" || v === null) continue;
    const entry = v as { via?: unknown; fixAvailable?: unknown };
    const fix = entry.fixAvailable;
    const params: Record<string, string> = {};
    if (fix === true) params.auditFix = "1";
    if (typeof fix === "object" && fix !== null) {
      const f = fix as { name?: unknown; version?: unknown; isSemVerMajor?: unknown };
      if (
        typeof f.name === "string" &&
        NPM_NAME.test(f.name) &&
        typeof f.version === "string" &&
        SEMVER.test(f.version)
      ) {
        params.fixName = f.name;
        params.fixVersion = f.version;
        params.fixMajor = f.isSemVerMajor === true ? "1" : "0";
      }
    }
    // Only the advisories on this package itself; a mere path through another
    // vulnerable package is that package's finding.
    for (const via of Array.isArray(entry.via) ? entry.via.slice(0, 50) : []) {
      if (typeof via !== "object" || via === null) continue;
      const a = via as { source?: unknown; title?: unknown; url?: unknown; severity?: unknown };
      if (typeof a.source !== "number" || !Number.isSafeInteger(a.source)) continue;
      const severity = SEVERITY[String(a.severity)];
      if (severity === undefined) continue;
      const words = advisoryText(a.title);
      const suspicious = words === null && typeof a.title === "string" && a.title.trim() !== "";
      out.push({
        type: "npm_advisory",
        target: pkg,
        occurrence: String(a.source),
        severity,
        title: `Faille ${severity === "eleve" ? "élevée" : severity} dans ${pkg} (avis ${a.source})${
          words !== null
            ? ` : ${words}`
            : suspicious
              ? " — texte de l'avis suspect, non affiché"
              : ""
        }`,
        params: {
          ...params,
          package: pkg,
          ...(typeof a.url === "string" && ADVISORY_URL.test(a.url) ? { url: a.url } : {}),
        },
      });
    }
  }
  return out;
}

/** Direct dependencies a whole major version behind: worth a look, never urgent. */
export function parseNpmOutdated(raw: string): Observation[] {
  const text = plainOutput(raw).trim();
  const data = text === "" ? {} : json(text, "npm_outdated");
  const out = new Map<string, Observation>();
  for (const [pkg, value] of Object.entries(data).slice(0, 500)) {
    if (!NPM_NAME.test(pkg)) continue;
    for (const v of (Array.isArray(value) ? value : [value]).slice(0, 50)) {
      if (typeof v !== "object" || v === null) continue;
      const { current, latest } = v as { current?: unknown; latest?: unknown };
      if (typeof current !== "string" || typeof latest !== "string") continue;
      if (!SEMVER.test(current) || !SEMVER.test(latest)) continue;
      if (Number(latest.split(".")[0]) <= Number(current.split(".")[0])) continue;
      out.set(pkg, {
        type: "npm_major",
        target: pkg,
        occurrence: latest,
        severity: "faible",
        title: `${pkg} a une version majeure de retard : ${current} → ${latest}`,
        params: { package: pkg, current, latest },
      });
    }
  }
  return [...out.values()];
}
