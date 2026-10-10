/**
 * Reading the Mac's own answers (J6a): FileVault, the firewall, SIP,
 * Gatekeeper, pending software updates, Tailscale. Each parser is strict: an
 * answer it does not recognise is a CheckOutputError (the check "could not
 * run"), never "all is well". Outputs are capped and stripped of terminal
 * escapes before reading; a title is rebuilt from checked pieces, never copied.
 */
import { CheckOutputError, type Observation } from "./types.ts";

const MAX_OUTPUT = 64_000;
/** Terminal escapes and control characters out; long outputs cut. */
export const plainOutput = (raw: string) =>
  raw
    .slice(0, MAX_OUTPUT)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escapes are removed on purpose.
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

const MAC = { target: "mac" } as const;

export function parseFileVault(raw: string): Observation[] {
  const text = plainOutput(raw).trim();
  if (/^FileVault is On\./m.test(text)) return [];
  if (/^FileVault is Off\./m.test(text)) {
    return [
      {
        type: "filevault_off",
        ...MAC,
        occurrence: "off",
        severity: "critique",
        title: "Le disque du Mac n'est pas chiffré (FileVault désactivé)",
      },
    ];
  }
  throw new CheckOutputError("filevault");
}

export function parseFirewall(raw: string): Observation[] {
  const text = plainOutput(raw);
  const state = /\(State = (\d)\)/.exec(text)?.[1];
  if (state === "1" || state === "2") return [];
  if (state === "0") {
    return [
      {
        type: "firewall_off",
        ...MAC,
        occurrence: "off",
        severity: "moyen",
        title: "Le pare-feu de macOS est désactivé",
      },
    ];
  }
  throw new CheckOutputError("firewall");
}

export function parseSip(raw: string): Observation[] {
  const text = plainOutput(raw);
  if (/System Integrity Protection status: enabled\./.test(text)) return [];
  if (/System Integrity Protection status: disabled\./.test(text)) {
    return [
      {
        type: "sip_off",
        ...MAC,
        occurrence: "off",
        severity: "eleve",
        title: "La protection de l'intégrité du système (SIP) est désactivée",
      },
    ];
  }
  throw new CheckOutputError("sip");
}

export function parseGatekeeper(raw: string): Observation[] {
  const text = plainOutput(raw).trim();
  if (/^assessments enabled$/m.test(text)) return [];
  if (/^assessments disabled$/m.test(text)) {
    return [
      {
        type: "gatekeeper_off",
        ...MAC,
        occurrence: "off",
        severity: "eleve",
        title: "Gatekeeper est désactivé : des applications non vérifiées peuvent s'ouvrir",
      },
    ];
  }
  throw new CheckOutputError("gatekeeper");
}

const LABEL = /^[A-Za-z0-9 ._()+-]{1,100}$/;
const VERSION = /^\d{1,3}(?:\.\d{1,4}){0,3}$/;
const NAME = /^[A-Za-z0-9 .()+-]{1,60}$/;

/**
 * `softwareupdate -l`. A point release of macOS or an update of Safari is a
 * security matter; a new major version of macOS is only news.
 */
export function parseSoftwareUpdate(raw: string, currentMacMajor: number): Observation[] {
  const text = plainOutput(raw);
  if (/No new software available\./.test(text)) return [];
  if (!/Software Update found the following/.test(text))
    throw new CheckOutputError("softwareupdate");
  const out: Observation[] = [];
  const blocks = text.split(/^\* Label: /m).slice(1);
  for (const block of blocks.slice(0, 30)) {
    const [labelLine = "", details = ""] = block.split("\n");
    const label = labelLine.trim();
    const title = /Title: ([^,]+),/.exec(details)?.[1]?.trim() ?? "";
    const version = /Version: ([^,]+),/.exec(details)?.[1]?.trim() ?? "";
    if (!LABEL.test(label) || !NAME.test(title) || !VERSION.test(version)) {
      throw new CheckOutputError("softwareupdate");
    }
    const major = /^macOS\b/.test(title) ? Number(version.split(".")[0]) : null;
    const upgrade = major !== null && major > currentMacMajor;
    out.push({
      type: upgrade ? "macos_upgrade" : "software_update",
      target: title,
      occurrence: version,
      severity: upgrade ? "info" : "moyen",
      title: upgrade
        ? `Nouvelle version majeure disponible : ${title} (à prévoir, pas urgent)`
        : `Mise à jour en attente : ${title.includes(version) ? title : `${title} ${version}`}`,
      params: { label },
    });
  }
  return out;
}

const semver = (v: string) => v.split(".").map((n) => Number(n));
function older(a: string, b: string): boolean {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** `tailscale version --upstream --json`: the installed and the latest versions. */
export function parseTailscale(raw: string): Observation[] {
  let data: unknown;
  try {
    data = JSON.parse(plainOutput(raw));
  } catch {
    throw new CheckOutputError("tailscale");
  }
  const d = data as { short?: unknown; upstream?: unknown };
  if (typeof d.short !== "string" || typeof d.upstream !== "string")
    throw new CheckOutputError("tailscale");
  if (!VERSION.test(d.short) || !VERSION.test(d.upstream)) throw new CheckOutputError("tailscale");
  if (!older(d.short, d.upstream)) return [];
  return [
    {
      type: "tailscale_outdated",
      target: "tailscale",
      occurrence: d.upstream,
      severity: "moyen",
      title: `Tailscale n'est pas à jour : ${d.short} installé, ${d.upstream} disponible`,
    },
  ];
}
