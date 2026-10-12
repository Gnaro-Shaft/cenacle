/**
 * What the operator tells me on Telegram (J6f, ADR-0027): the machine, the
 * finding, the outcome, in plain words — never a server's output, an address
 * or a key path. One wording per action of the catalogue where it matters.
 */
import type { StoredServerAction } from "@cenacle/journal";
import { SERVER_CATALOGUE } from "@cenacle/securite";

const REFUSAL: Readonly<Record<string, string>> = {
  interrupteur: "les actions sur les serveurs sont coupées ([serveurs] actif dans securite.toml)",
  configuration: "serveurs.local.toml est absent ou illisible",
  machine_inconnue: "cette machine n'est pas déclarée dans serveurs.local.toml",
  pas_de_cle: "aucune clé n'est déclarée pour cette action sur cette machine",
  cle_mal_protegee: "sa clé est lisible par un autre que toi (chmod 600)",
  releve_perime: "le relevé de Legion a plus de 35 minutes : rien n'est sûr",
  releve_illisible: "le relevé de Legion est illisible",
  plus_de_motif: "le dernier relevé de Legion ne montre plus le problème : rien à faire",
  redemarrage_recent: "Cénacle l'a déjà redémarrée il y a moins de 24 heures",
};

function updated(a: StoredServerAction, on: string): string {
  switch (a.verified) {
    case "disparu":
      return `✅ ${on} : plus aucune mise à jour de sécurité en attente dans le relevé de Legion.`;
    case "toujours_la":
      return `⚠ ${on} : des mises à jour de sécurité sont encore en attente 2 heures après — à regarder sur la machine (journalctl -u cenacle-maj).`;
    default:
      return `⬆ ${on} : mises à jour de sécurité lancées sur la machine, sans redémarrage. J'attends les relevés de Legion (jusqu'à 2 heures).`;
  }
}

function done(a: StoredServerAction, on: string): string {
  if (a.action === "maj_securite") return updated(a, on);
  const reboot = a.action === "redemarrer";
  switch (a.verified) {
    case "disparu":
      return reboot
        ? `✅ ${on} est revenue : le relevé de Legion ne demande plus de redémarrage.`
        : `✅ ${on} : le relevé de Legion ne montre plus le problème, l'action a pris.`;
    case "toujours_la":
      return reboot
        ? `⚠ ${on} est revenue, mais le relevé de Legion demande encore un redémarrage — à regarder sur la machine.`
        : `⚠ ${on} : le relevé de Legion montre encore le problème — à regarder sur la machine (journalctl -t cenacle).`;
    case "pas_revenue":
      return `🚨 ${on} n'est pas revenue 30 minutes après le redémarrage : à vérifier tout de suite.`;
    case "reduit":
      return `✅ ${on} : ${a.beforeCount ?? "?"} → ${a.afterCount ?? "?"} service(s) sur une bibliothèque remplacée. Les ${a.afterCount ?? ""} restants sont sans doute ceux que le script épargne (dbus, systemd, la grappe…) — à relancer à la main, ou au prochain redémarrage (journalctl -t cenacle pour le détail).`;
    default:
      return reboot
        ? `🔄 ${on} : redémarrage programmé dans 1 minute. J'attends son retour dans les relevés de Legion (jusqu'à 30 minutes).`
        : `🔁 ${on} : ${SERVER_CATALOGUE[a.action].label}, fait. J'attends le prochain relevé de Legion pour le confirmer.`;
  }
}

export function message(a: StoredServerAction): string {
  const on = `${a.host} (constat n°${a.findingId})`;
  const reboot = a.action === "redemarrer";
  switch (a.state) {
    case "faite":
      return done(a, on);
    case "rien_a_faire":
      if (a.action === "maj_securite") {
        return `⬆ ${on} : rien à faire — unattended-upgrade n'est pas installé sur la machine.`;
      }
      return reboot
        ? `🔄 ${on} : rien à faire — le serveur ne demande pas de redémarrage.`
        : `🔁 ${on} : rien à faire — le script n'a trouvé aucun service à relancer hors de ses exclusions.`;
    case "refusee_serveur":
      if (a.action === "maj_securite") {
        return `🛑 ${on} : un garde-fou du serveur a refusé (redémarrage automatique réglé, mise à jour déjà en cours, ou moins de 1 Go libre) — rien n'a été lancé (journalctl -t cenacle).`;
      }
      return reboot
        ? `🛑 ${on} : un garde-fou du serveur a refusé (redémarrée depuis moins de 24 h, grappe incomplète, ou invités encore en marche sur le nœud) — rien n'a été fait (journalctl -t cenacle).`
        : `🛑 ${on} : un garde-fou du serveur a refusé, rien n'a été fait (journalctl -t cenacle sur la machine).`;
    case "refusee":
      return `🛑 ${on} : rien n'a été fait — ${REFUSAL[a.refusal ?? ""] ?? "refus de l'opérateur"}.`;
    case "expiree":
      return `⌛ ${on} : demande non confirmée dans les 2 minutes, rien n'a été fait.`;
    case "echouee":
      if (a.exitCode === 255)
        return `🛑 ${on} : serveur injoignable ou clé refusée — rien n'est sûr, à vérifier.`;
      if (a.exitCode === -1)
        return `🛑 ${on} : l'action a été coupée en cours — état inconnu, à vérifier sur la machine.`;
      return `🛑 ${on} : l'action a échoué (code ${a.exitCode ?? "?"}) — journalctl -t cenacle sur la machine.`;
    default:
      return `${on} : ${a.state}`;
  }
}
