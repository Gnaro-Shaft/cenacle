# Le redémarrage après correctif, sur le VPS du site public

Posé par Legion le 25/09/2026, sur **le VPS du site public seulement** ; **coupé le 26/10/2026**, quand ce VPS a été équipé pour les actions de Cénacle ; déménagé dans Cénacle le 19/11/2026 (ADR-0045, point 6 et sa précision), **tel qu'il est sur le serveur**.

## Ce qu'il fait aujourd'hui

`52legion-redemarrage` dit à `unattended-upgrades` de **ne pas** redémarrer seul : `Automatic-Reboot "false"`. Les correctifs de sécurité s'installent toujours seuls ; un noyau corrigé attend le bouton 🔄 de Cénacle, et la ronde dit « redémarrage requis » d'ici là.

Pourquoi l'avoir coupé : `cenacle-maj-securite`, le bouton « mises à jour de sécurité », refuse de tourner sur une machine réglée pour redémarrer seule — un redémarrage doit rester un choix, au moment choisi. Les deux autres lignes (`WithUsers`, l'heure de 03:30 UTC) sont sans effet tant que la première vaut `"false"`.

Un fichier à part, pour que les installateurs des sites, qui écrivent `20auto-upgrades`, ne l'écrasent pas.

## Poser

```bash
scp deploy/homelab/redemarrage-auto/52legion-redemarrage <compte@vps>:/tmp/
ssh <compte@vps> 'sudo install -m 644 -o root -g root /tmp/52legion-redemarrage /etc/apt/apt.conf.d/'
ssh <compte@vps> 'apt-config dump | grep Automatic-Reboot'   # trois lignes, la première à "false"
```

## Pourquoi ce VPS, et pas les autres

| Machine | Ce fichier | Pourquoi |
|---|---|---|
| **le VPS du site public** | **oui** | sites statiques et deux petits services ; il porte la trace du réglage |
| le VPS du bot | non | le bot de trading s'arrêterait en position ouverte — c'est pour lui qu'existe le garde-fou `needrestart` |
| les nœuds de la grappe | non | le quorum est compté au plus juste, et un nœud a perdu son réseau à un redémarrage (adaptateur USB, voir `grappe/`) |

## Éprouvé

`packages/homelab/src/redemarrage-auto.adversarial.test.ts`, dans un Debian jetable : `apt-config dump` rend les trois réglages, `"false"` en tête, même à côté d'un `20auto-upgrades` réécrit ; le vrai `cenacle-maj-securite` accepte cette machine, et la refuse si la ligne repasse à `"true"`.

Avant la coupure, le 26/09/2026, le redémarrage automatique avait été constaté : arrêt à 03:30:01 UTC, machine revenue à 03:30:03, la ronde repassée à SAIN d'elle-même. Pour le rallumer un jour : passer la ligne à `"true"`, **et** retirer à ce VPS le bouton « mises à jour de sécurité » dans `serveurs.local.toml`.
