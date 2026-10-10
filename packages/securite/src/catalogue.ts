/**
 * The closed catalogue of fixes (J6a; Legion's ADR-031). For each kind of
 * finding: advice written here, and when it can be, a command built only from
 * values the parsers checked — never copied from a tool's output, never
 * written by the model. The agent proposes; I run it myself, or not.
 */
import { NPM_NAME, SEMVER } from "./parse-npm.ts";
import type { FindingKey } from "./types.ts";

export interface Fix {
  /** What to do, in French. */
  readonly advice: string;
  /** A command to copy and run yourself, if there is a safe one. */
  readonly command: string | null;
}

export class UnknownFindingError extends Error {
  constructor(type: string) {
    super(`no catalogue entry for ${JSON.stringify(type).slice(0, 60)}`);
    this.name = "UnknownFindingError";
  }
}

const LABEL = /^[A-Za-z0-9 ._()+-]{1,100}$/;
const quoted = (s: string) => `"${s}"`;

type Builder = (key: FindingKey, p: Readonly<Record<string, string>>) => Fix;

const CATALOGUE: Readonly<Record<string, Builder>> = {
  filevault_off: () => ({
    advice: "Activer FileVault : Réglages Système › Confidentialité et sécurité › FileVault.",
    command: null,
  }),
  firewall_off: () => ({
    advice: "Activer le pare-feu : Réglages Système › Réseau › Coupe-feu.",
    command: "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on",
  }),
  sip_off: () => ({
    advice: "Réactiver SIP depuis le mode de récupération (csrutil enable), puis redémarrer.",
    command: null,
  }),
  gatekeeper_off: () => ({
    advice: "Réactiver Gatekeeper.",
    command: "sudo spctl --master-enable",
  }),
  software_update: (_k, p) => ({
    advice: "Installer la mise à jour (Réglages Système › Général › Mise à jour de logiciels).",
    command:
      p.label !== undefined && LABEL.test(p.label)
        ? `softwareupdate --install ${quoted(p.label)}`
        : null,
  }),
  macos_upgrade: () => ({
    advice:
      "Une nouvelle version majeure : à prévoir quand tes outils la supportent (LM Studio, Docker, Node).",
    command: null,
  }),
  tailscale_outdated: () => ({
    advice: "Mettre Tailscale à jour.",
    command: "tailscale update",
  }),
  npm_advisory: (_k, p) => {
    if (
      p.fixName !== undefined &&
      p.fixVersion !== undefined &&
      NPM_NAME.test(p.fixName) &&
      SEMVER.test(p.fixVersion)
    ) {
      const major = p.fixMajor === "1" ? " (version majeure : relire les changements avant)" : "";
      return {
        advice: `Mettre à jour ${p.fixName} en ${p.fixVersion}${major}, puis npm run check.`,
        command: `npm install ${p.fixName}@${p.fixVersion}`,
      };
    }
    if (p.auditFix === "1")
      return {
        advice: "Un correctif existe : l'appliquer, puis npm run check.",
        command: "npm audit fix",
      };
    return {
      advice:
        "Aucun correctif publié : surveiller l'avis, et évaluer si le chemin vulnérable est atteint.",
      command: null,
    };
  },
  npm_major: (_k, p) => ({
    advice: `Envisager la montée de version de ${p.package ?? "ce paquet"} (${p.current ?? "?"} → ${p.latest ?? "?"}) : lire ses changements avant.`,
    command: null,
  }),
  check_impossible: (k) => ({
    advice: `Le contrôle « ${k.target} » n'a pas pu tourner : rien n'est prouvé tant qu'il ne repasse pas.`,
    command: null,
  }),
};

export const CATALOGUE_TYPES: readonly string[] = Object.keys(CATALOGUE);

export function fixFor(key: FindingKey, params: Readonly<Record<string, string>> = {}): Fix {
  const build = Object.hasOwn(CATALOGUE, key.type) ? CATALOGUE[key.type] : undefined;
  if (build === undefined) throw new UnknownFindingError(key.type);
  return build(key, params);
}
