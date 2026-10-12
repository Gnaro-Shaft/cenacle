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
const HOST = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOUNT = /^\/[A-Za-z0-9._/-]{0,100}$/;
const PORT = /^(?:[a-z]{2,10}\/)?(?:tcp|udp)\/(\d{1,5}|\*)$/;
/** "Sur homeserv01 : " — where a server command is to be run, the name checked. */
const on = (p: Readonly<Record<string, string>>) =>
  p.host !== undefined && HOST.test(p.host) ? `Sur ${p.host} : ` : "Sur la machine : ";
const quoted = (s: string) => `"${s}"`;

type Builder = (key: FindingKey, p: Readonly<Record<string, string>>) => Fix;

const CERTFR_URL =
  /^https:\/\/www\.cert\.ssi\.gouv\.fr\/(?:alerte|avis)\/CERTFR-\d{4}-(?:ALE|AVI)-\d{1,5}\/$/;
const bulletin = (p: Readonly<Record<string, string>>): Fix => ({
  advice: `Lire le bulletin${
    p.url !== undefined && CERTFR_URL.test(p.url) ? ` (${p.url})` : ""
  } et appliquer ses correctifs${
    p.software !== undefined && LABEL.test(p.software) ? ` pour ${p.software}` : ""
  } ; ✅ quand c'est fait, ☑ si tu n'es pas concerné (avec la raison).`,
  command: null,
});

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
  // The servers, through Legion's ronde (the bridge): commands to run on the machine.
  serveur_quorum: (_k, p) => ({
    advice: `${on(p)}grappe Proxmox sans quorum, /etc/pve en lecture seule : vérifier les nœuds et le réseau du cluster.`,
    command: "pvecm status",
  }),
  serveur_disque: (_k, p) => ({
    advice: `${on(p)}libérer de la place sur ${p.mount ?? "ce disque"} (journaux, images Docker, sauvegardes anciennes).`,
    command:
      p.mount !== undefined && MOUNT.test(p.mount)
        ? `sudo du -xh --max-depth=1 ${p.mount} | sort -h | tail -15`
        : null,
  }),
  serveur_maj_securite: (_k, p) => ({
    advice: `${on(p)}appliquer les mises à jour de sécurité, puis voir si un redémarrage est demandé.`,
    command: "sudo apt update && sudo apt full-upgrade",
  }),
  serveur_port: (_k, p) => {
    const port = p.port !== undefined && PORT.test(p.port) ? p.port : null;
    if (port?.startsWith("tailnet/")) {
      return {
        advice: `${on(p)}port Tailscale tiré au hasard à chaque démarrage : déclarer le joker tailnet/tcp/* dans la ronde de Legion (maison.toml), sans quoi il revient à chaque redémarrage.`,
        command: null,
      };
    }
    const num = port === null ? null : (PORT.exec(port)?.[1] ?? null);
    if (port?.startsWith("local/")) {
      // The loopback only (Legion's ronde, 2026-10-12): a random port of the
      // ephemeral range is a tool picking one at each start (llama-server).
      const ephemeral = num !== null && num !== "*" && Number(num) >= 32768;
      return {
        advice: ephemeral
          ? `${on(p)}port de la boucle locale tiré au hasard (un outil qui en change à chaque lancement, comme llama-server) : s'il est voulu, déclarer le joker local/tcp/* pour cet hôte dans la ronde de Legion (maison.toml) — il ne couvre que la boucle locale, à partir de 32768.`
          : `${on(p)}service de la boucle locale sur un port fixe : identifier ce qui écoute ; si c'est normal, déclarer ${port} attendu dans la ronde de Legion (maison.toml).`,
        command: num !== null && num !== "*" ? `sudo ss -lntp | grep ':${num} '` : null,
      };
    }
    return {
      advice: `${on(p)}identifier ce qui écoute sur ${port ?? "ce port"} ; si c'est normal, le déclarer attendu dans la ronde de Legion (maison.toml) ; sinon, arrêter ce service.`,
      command: num !== null && num !== "*" ? `sudo ss -lntup | grep ':${num} '` : null,
    };
  },
  serveur_port_absent: (_k, p) => {
    const num = p.port !== undefined ? (PORT.exec(p.port)?.[1] ?? null) : null;
    return {
      advice: `${on(p)}un service attendu n'écoute plus sur ${p.port ?? "ce port"} : vérifier qu'il tourne.`,
      command: num !== null && num !== "*" ? `sudo ss -lntup | grep ':${num} '` : null,
    };
  },
  serveur_redemarrage: (_k, p) => ({
    advice: `${on(p)}un noyau corrigé attend un redémarrage : à planifier, c'est une décision à toi.`,
    command: null,
  }),
  serveur_services: (_k, p) => ({
    advice: `${on(p)}relancer les services qui tournent sur une bibliothèque remplacée (la liste d'abord).`,
    command: "sudo needrestart -r l",
  }),
  serveur_autre: (_k, p) => ({
    advice: `${on(p)}motif signalé par la ronde de Legion : à examiner sur la machine.`,
    command: null,
  }),
  // My other projects (J6e2): never a 🔧, the commands are for me to run there.
  projet_npm: (_k, p) => {
    const where = `Dans le projet ${p.project ?? "concerné"} : `;
    if (
      p.fixName !== undefined &&
      p.fixVersion !== undefined &&
      NPM_NAME.test(p.fixName) &&
      SEMVER.test(p.fixVersion)
    ) {
      const major = p.fixMajor === "1" ? " (version majeure : relire les changements avant)" : "";
      return {
        advice: `${where}mettre à jour ${p.fixName} en ${p.fixVersion}${major}, puis lancer ses tests.`,
        command: `npm install ${p.fixName}@${p.fixVersion}`,
      };
    }
    if (p.auditFix === "1")
      return {
        advice: `${where}un correctif existe : l'appliquer, puis lancer ses tests.`,
        command: "npm audit fix",
      };
    return {
      advice: `${where}aucun correctif publié : surveiller l'avis, et évaluer si le chemin vulnérable est atteint.`,
      command: null,
    };
  },
  projet_fuite: (_k, p) => ({
    advice: `Dans le projet ${p.project ?? "concerné"} : tenir ce secret pour exposé — le révoquer et en créer un autre, puis le retirer de l'historique si le dépôt est partagé. Un faux positif : ☑ garder le risque, avec la raison.`,
    command: null,
  }),
  // The CERT-FR's bulletins (J6e3): read it, apply its fixes; ✅ means done.
  bulletin_alerte: (_k, p) => bulletin(p),
  bulletin_avis: (_k, p) => bulletin(p),
  check_impossible: (k) => ({
    advice: `Le contrôle « ${k.target} » n'a pas pu tourner : rien n'est prouvé tant qu'il ne repasse pas.`,
    command: null,
  }),
};

export const CATALOGUE_TYPES: readonly string[] = Object.keys(CATALOGUE);

/**
 * The fix an agent may prepare itself (J6c): only a dependency with a
 * published version, the name and version checked. Anything else — the Mac,
 * the servers, an `npm audit fix` of unknown reach — stays mine.
 */
export function preparedFix(
  key: FindingKey,
  params: Readonly<Record<string, string>>,
): { readonly name: string; readonly version: string } | null {
  if (key.type !== "npm_advisory") return null;
  const { fixName, fixVersion } = params;
  if (fixName === undefined || fixVersion === undefined) return null;
  if (!NPM_NAME.test(fixName) || !SEMVER.test(fixVersion)) return null;
  return { name: fixName, version: fixVersion };
}

export function fixFor(key: FindingKey, params: Readonly<Record<string, string>> = {}): Fix {
  const build = Object.hasOwn(CATALOGUE, key.type) ? CATALOGUE[key.type] : undefined;
  if (build === undefined) throw new UnknownFindingError(key.type);
  return build(key, params);
}
