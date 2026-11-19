# La copie des sauvegardes (`copie-dumps`)

Sortir les sauvegardes `vzdump` de la machine qui les produit. Déménagé de Legion le 19/11/2026, **à l'identique** (ADR-0045) ; ses raisons viennent de l'ADR-024 de Legion. Les seuls changements : aucun vrai nom dans le dépôt — la source et la destination se lisent dans `/etc/default/copie-dumps` (voir plus bas) — et les épreuves tournent sous vitest.

## Le problème

La tâche `vzdump` de la grappe écrit sur le stockage `local`, c'est-à-dire `/var/lib/vz/dump` **du nœud qui héberge l'invité**. Les sauvegardes d'un invité vivent donc sur le disque de la machine qui le fait tourner : ce n'est pas une sauvegarde, c'est une copie sur le même disque.

Le 16/09/2026, le disque d'un nœud a lâché. Il ne portait aucune sauvegarde — mais il portait un invité absent de toute tâche de sauvegarde, et deux jours ont passé sans que rien ne le dise.

## Les deux sens

| Unité | Sur | Heure | Tire depuis | Écrit dans |
|---|---|---|---|---|
| `copie-dumps` | le nœud de sauvegarde | 04:15 (surcharge `horaire.conf` ; 03:00 dans le `.timer`) | l'autre nœud | sa `COPIE_DEST` |
| `copie-dumps-retour` | l'autre nœud | 03:30 | le nœud de sauvegarde | sa `COPIE_DEST` |

Le script est le **même** : il ne connaît aucune machine, seulement ses variables, que chaque unité lit dans **son** `/etc/default/copie-dumps`. Les deux nœuds doivent avoir la même version de `copier-les-dumps` et de `copie-dumps-tirage`. Le nœud de sauvegarde **tire**, l'autre ne pousse pas : rien n'est installé sur la machine observée par la première unité. Les deux ne se chevauchent pas : lancées ensemble, chaque machine lirait et écrirait en même temps.

Chacun écrit `/var/lib/copie-dumps/verdict` au format commun ; le bulletin de Cénacle le récite (`sauvegarde.copie-dumps.*`, ADR-0043), sans jamais un motif.

## Les décisions qui surprennent

- **La destination est hors de `/var/lib/vz`.** Dans `/var/lib/vz/dump`, Proxmox la tiendrait pour son propre stockage `local` : un élagage pourrait l'effacer. Une sauvegarde que l'outil sauvegardé peut effacer n'en est pas une. Le prix : la restauration n'est pas un clic (plus bas).
- **Tous les jours, pas le seul samedi.** Les autres jours, `rsync` ne trouve rien et coûte quelques secondes : c'est ce qui rattrape un samedi où le nœud était éteint, sans mécanisme de rattrapage.
- **Pas de `--delete`.** Et `--partial-dir`, jamais `--partial` seul : ce dernier garde le fragment d'un transfert coupé sous son nom définitif.
- **Trois copies par invité, et on ne tire que ces trois-là.** Tirer tout le répertoire faisait revenir chaque nuit les dumps élagués la veille. `.dat` et `.tmp` (un dump en cours d'écriture) ne sont jamais tirés.
- **Le pool thin compte, pas `df`.** Un bloc supprimé ne revient au pool qu'au `fstrim` (chaque jour à 06:00, `fstrim-quotidien.conf`). Au-delà de 90 % du pool, la copie est refusée sans rien détruire ; un pool illisible la refuse aussi. Le verdict porte `pool_pct` (« - » hors pool thin).
- **`rsync --fsync`** : sur un pool plein, l'écriture différée échoue après la fin de rsync, qui sortirait en code 0.
- **Dix jours avant de crier qu'une sauvegarde est vieille** — un samedi manqué plus la marge d'un rattrapage.
- **Un dump contrôlé en échec n'est ni gardé, ni élagué** : il reste, et le verdict le nomme. Sinon un dump neuf et corrompu chasserait trois dumps sains.
- **Un compteur d'échecs par direction** : un compteur unique ferait crier sur un sens sain parce que l'autre a échoué.

## Sortir d'un verdict MALADE

Un dump en échec encore présent à la source est **réparé seul** au passage suivant (`--checksum`, puis recontrôle). Un dump en échec qui n'est plus à la source ne peut pas guérir : il maintient le verdict MALADE, délibérément. Vérifier que l'invité a ses copies saines (`invite=<id>:<saines>:<âge>` dans le verdict), puis retirer à la main l'archive, son `.log`, son `.notes` et son `controles/<nom>.controle`.

## Poser

**D'abord la configuration**, sur chaque nœud, d'après `copie-dumps.exemple.conf` — root seul :

```
install -m 600 /dev/null /etc/default/copie-dumps
# puis y écrire COPIE_SOURCE=root@<l'autre nœud>:/var/lib/vz/dump/ et COPIE_DEST=/var/backups/<…>-dump
```

Absente ou hors de forme, rien n'est tiré : l'unité passe en échec, `journalctl -u copie-dumps` nomme la variable (jamais sa valeur), et le verdict, qui ne se renouvelle plus, se lit comme périmé.

**Puis les fichiers**, aux mêmes chemins qu'au temps de Legion — depuis le Mac, `rsync -a deploy/homelab <compte>@<nœud>:cenacle-homelab/`, puis, sur le nœud de sauvegarde :

```
install -m 755 ~/cenacle-homelab/homelab/copie-dumps/copier-les-dumps /usr/local/bin/
install -m 644 ~/cenacle-homelab/homelab/copie-dumps/copie-dumps-tirage /usr/local/bin/
install -m 644 ~/cenacle-homelab/homelab/copie-dumps/copie-dumps.{service,timer} /etc/systemd/system/
install -D -m 644 ~/cenacle-homelab/homelab/copie-dumps/copie-dumps-horaire.conf /etc/systemd/system/copie-dumps.timer.d/horaire.conf
install -D -m 644 ~/cenacle-homelab/homelab/copie-dumps/fstrim-quotidien.conf /etc/systemd/system/fstrim.timer.d/quotidien.conf
systemctl daemon-reload
```

Sur l'autre nœud : les deux scripts de même, `copie-dumps-retour.{service,timer}`, `systemctl daemon-reload`. L'autre nœud n'est pas sur le tailnet : on l'atteint en rebond depuis le nœud de sauvegarde. Les minuteurs sont déjà activés depuis Legion ; un premier passage à la main (`systemctl start copie-dumps.service`) montre le verdict.

## Éprouver

Les épreuves de Legion sont gardées telles quelles (`eprouver-copie.sh`, qui charge `eprouver-copie-pannes.sh` : 139 épreuves, dont l'échec réel de `fsync` par `strace`). `packages/homelab/src/copie-dumps.adversarial.test.ts` les lance dans un Debian jetable, puis éprouve ce que le déménagement ajoute : la configuration absente ou hors de forme, et le verdict lu par le vrai bulletin. Sur un nœud, avant de déployer : `bash eprouver-copie.sh ./copier-les-dumps` (le harnais accepte qu'on lui désigne le script). Il ne rejoue pas un pool thin réellement plein.

## Restaurer

Les dumps ne sont pas dans un stockage Proxmox — c'est délibéré. Deux voies : recopier le dump dans `/var/lib/vz/dump` du nœud qui le restaurera, puis restaurer normalement ; ou `pct restore <id> <COPIE_DEST>/vzdump-lxc-<id>-….tar.zst` directement depuis le fichier.

## Ce que ce dispositif ne fait pas

- Il ne vérifie pas qu'un dump **restaure** : `zstd -t` dit que les octets sont arrivés entiers, rien de plus.
- Il ne sauvegarde que ce que la tâche `vzdump` produit : un invité absent de la tâche n'est copié par personne.
- Un incident terminé ne laisse de trace que dans `journalctl -u copie-dumps --since '-10 days'`.

## Ce qu'elle coûte, mesuré (Legion, 2026)

Le premier passage — 26 Go à transférer et à contrôler : 16 min 52 s ; un passage ordinaire : 0,4 s ; `rsync` vers une machine morte : échec en 1,6 s, code 255. `TimeoutStartSec=1h` laisse une marge large. **Attendre la fin de l'unité** : un `oneshot` en cours est `activating`, jamais `active` — lire `systemctl show … -p ActiveState --value`.
