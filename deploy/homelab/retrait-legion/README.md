# Le retrait de Legion (`retrait-legion`)

Retirer de chaque machine ce que Legion y a laissé, dans l'ordre de l'ADR-0046 : **les accès d'abord, les fichiers ensuite, les données en dernier**. Legion est arrêté depuis le 22/11 ; ce dossier sert à le retirer pour de bon.

Tout se fait **de ma main**, une machine à la fois, en root. Cénacle ne se connecte jamais en root et ne retire rien lui-même. Chaque commande se relit avant d'être lancée.

## L'inventaire

`inventaire-legion` ne fait que lire. Il cherche une liste fermée de traces, celles que le dépôt de Legion dit avoir posées. Pour chacune, il dit `PRÉSENTE`, `absente` ou `ILLISIBLE` :

- il n'affiche aucun contenu : une ligne de clé se compte, un dossier se dit présent avec sa taille, un compte humain se désigne par son uid (`getent passwd <uid>` donne son nom) ;
- il ne suit aucun lien symbolique ;
- il ne signale jamais les pièces gardées exprès : `52legion-redemarrage`, `90-legion-rebrancher-nic0.rules`, `rebrancher-nic0.*`, `attendre-la-grappe`, `legion-maj-*`. Ce sont des pièces de Cénacle sous leur vieux nom.

Chaque section de sa sortie porte son palier (`L2`, `L3`, `L4`). Il finit par un bilan :

| Sortie | Bilan |
|---|---|
| 0 | `rien ne reste` |
| 1 | `reste N trace(s)`, suivi de leur liste |
| 2 | rien de présent, mais une lecture impossible : relancer en root |

On le copie sur la machine comme `deploy/serveurs/`, puis on le lance en root :

```bash
bash inventaire-legion
```

Sur le conteneur de Legion, on le lance depuis son nœud :

```bash
pct push <id du conteneur> inventaire-legion /root/inventaire-legion
```

```bash
pct exec <id du conteneur> -- bash /root/inventaire-legion
```

Ses épreuves : `packages/homelab/src/retrait-legion*.adversarial.test.ts`. Elles tournent sous Docker, sur des racines factices, et sont sautées sans Docker (la CI). Le test qui vérifie que le script ne modifie rien tourne partout.

## Le pas, sur chaque machine

**Inventaire, retrait, inventaire.** Un palier est fini sur une machine quand toutes les lignes de ses sections disent `absente`, sauf ce qui attend S3 (`copie-bases.*`, `/var/lib/copie-bases`). On ne passe à la machine suivante qu'à ce moment-là. `rien ne reste` n'arrive qu'à la fin de L4. Sur le nœud de sauvegarde, il arrive après S3, à cause de `/var/lib/copie-bases`.

Ce qu'on doit y trouver, d'après le dépôt de Legion (l'inventaire tranche) :

| Rôle | L2 | L3 | L4 |
|---|---|---|---|
| les VPS | une ligne `ronde-legion` dans le compte de l'administrateur | `legion-bulletin-hote`, `/var/lib/legion-ronde`, `legion.conf` | — |
| les nœuds | le compte `ronde`, ses lignes, `ronde-redemarrages`, `ronde-grappe` | les mêmes que les VPS | — |
| le conteneur de Legion | les lignes `legion-bulletin` et `copie-bases` chez root, la clé `/root/.ssh/ronde`, le compte `ronde`, `ronde-redemarrages`, le proxy | `legion-bulletin`, `legion-bulletin-hote`, les unités `legion*`, `/var/lib/legion-ronde`, `legion.conf` | `/root/projects/legion` (code et `.env`), `/root/storage/legion/.legion` |
| le nœud de sauvegarde | en plus d'un nœud : les clés `veilleur-legion` et `copie-bases` | `veilleur-legion`, `copier-les-bases`, leurs unités, `/root/veilleur`, `/root/copie-bases`, `/var/lib/veilleur-legion`, `/var/lib/copie-bases` (**après S3**) | `/var/backups/legion-bases` |

## L2 — les accès

**D'abord chez les tiers** (voir plus bas), puis sur le parc.

**Les lignes de clés.** Garder une seconde session SSH ouverte quand on touche au fichier du compte avec lequel on est connecté. D'abord, voir **quelles** clés partiraient : seul le dernier champ de chaque ligne s'affiche, son commentaire (la clé publique si elle n'en a pas).

```bash
grep -F -e ronde-legion -e legion-bulletin -e veilleur-legion -e copie-bases -e /.legion/ <fichier> | awk '{print $NF}'
```

Puis les retirer, avec une copie gardée dans `/root` jusqu'à l'inventaire propre :

```bash
retirer_lignes_legion() { f="$1"; c="/root/$(echo "$f" | tr / _).avant-legion"; [ ! -e "$c" ] || { echo "$c existe déjà : rien n'est fait"; return 1; }; cp -p -- "$f" "$c" && { grep -vF -e ronde-legion -e legion-bulletin -e veilleur-legion -e copie-bases -e /.legion/ -- "$c" || [ $? -eq 1 ]; } > /root/sans-legion.tmp && cat /root/sans-legion.tmp > "$f" && rm -- /root/sans-legion.tmp; }
```

```bash
retirer_lignes_legion <fichier>
```

- `cat >` réécrit le fichier **en place** : ses droits, son propriétaire et, sur un nœud, le lien de `/root/.ssh/authorized_keys` restent tels quels. `sed -i` remplacerait ce lien par un fichier.
- Sur un nœud, le fichier de root est `/etc/pve/priv/authorized_keys`, **partagé par la grappe** : on le traite une fois, sur un seul nœud, et on le nomme par ce chemin.
- Une ligne commentée qui nomme Legion part aussi ; l'inventaire, lui, ne la comptait pas.
- Relancée sur le même fichier, la fonction refuse : la première copie, celle d'avant le retrait, n'est jamais écrasée.
- Un fichier dont toutes les lignes sont à Legion (celui de `ronde`, un `authorized_keys2`) en sort **vide** : c'est voulu, mais ce n'est jamais le cas du compte avec lequel on est connecté.

**Les clés de Legion** : sur le conteneur, `/root/.ssh/ronde` et `ronde.pub` ; sur le nœud de sauvegarde, `veilleur-legion`, `copie-bases` et leurs `.pub`.

```bash
rm -f /root/.ssh/ronde /root/.ssh/ronde.pub
```

```bash
rm -f /root/.ssh/veilleur-legion /root/.ssh/veilleur-legion.pub /root/.ssh/copie-bases /root/.ssh/copie-bases.pub
```

**Le compte `ronde` et ses règles `sudo`**, là où l'inventaire les trouve. Le paquet `sudo` **reste** : le bulletin de Cénacle s'en sert.

```bash
userdel -r ronde
```

```bash
rm -f /etc/sudoers.d/ronde-redemarrages /etc/sudoers.d/ronde-grappe && visudo -c
```

**Le proxy**, sur le conteneur. D'abord, ce que sert le port 443 :

```bash
tailscale serve status
```

**Seulement si** `status` ne montre que `127.0.0.1:8787` sur le port 443 : la commande suivante retire tout ce que sert ce port.

```bash
tailscale serve --https=443 off
```

Le port 443 ne servait alors que Legion, il disparaît : le même jour, `tailnet/tcp/443` sort des ports attendus du conteneur dans `parc.local.toml`, sur le Mac. Sinon la ronde dit SOUFFRANT.

## L3 — les fichiers et les unités

**Les unités**, sur le conteneur et sur le nœud de sauvegarde : seulement celles que l'inventaire dit présentes, avec leurs surcharges (`<unité>.d`). `copie-bases.*` **après S3** : `relever-la-copie.sh` lit son verdict jusque-là.

```bash
systemctl disable --now <unités présentes>
```

```bash
cd /etc/systemd/system && rm -rf -- <unités et surcharges présentes> && systemctl daemon-reload && systemctl reset-failed
```

**Les fichiers posés**, partout où l'inventaire les trouve :

```bash
rm -f /usr/local/bin/legion-bulletin-hote /usr/local/bin/legion-bulletin /usr/local/bin/veilleur-legion /usr/local/bin/copier-les-bases
```

`legion.conf` ne part qu'**après avoir vu `zz-cenacle.conf` à côté**. Sans l'un ni l'autre, `needrestart` relancerait les services tout seul. L'inventaire le dit (`garde :`) ; la commande le revérifie :

```bash
test -f /etc/needrestart/conf.d/zz-cenacle.conf && rm /etc/needrestart/conf.d/legion.conf
```

**Les dossiers de travail** : le sel de la ronde, le verdict du veilleur, les documents.

```bash
rm -rf /var/lib/legion-ronde /var/lib/veilleur-legion /root/veilleur /root/copie-bases
```

`/var/lib/copie-bases`, **après S3 seulement** :

```bash
rm -rf /var/lib/copie-bases
```

## L4 — les données

Effacées, sans archive (ADR-0046, point 4). Rien n'est exporté avant, sauf demande.

Sur le conteneur : son code et son fichier d'environnement, sa base et ses copies. `rmdir` refuse si `/root/storage/legion` contient autre chose, et c'est voulu.

```bash
rm -rf /root/projects/legion /root/storage/legion/.legion && rmdir /root/storage/legion
```

Sur le nœud de sauvegarde, les copies de ses bases :

```bash
rm -rf /var/backups/legion-bases
```

**Puis le `fstrim`.** Sur un volume fin, un fichier effacé reste lisible sur le disque tant que ses blocs ne sont pas rendus. Pour le conteneur, depuis son nœud :

```bash
pct fstrim <id du conteneur>
```

Pour le volume des copies, sur le nœud de sauvegarde (`findmnt -T /var/backups` le nomme) :

```bash
fstrim -v "$(findmnt -n -o TARGET -T /var/backups)"
```

Enfin, l'inventaire de nouveau, et les copies `/root/*.avant-legion` effacées une fois qu'il dit `rien ne reste`.

## Ce qui s'efface seul

Rien à faire, seulement à constater :

- **Myriade** garde 30 jours de sa conversation, donc au plus tard jusqu'au 22/12.
- **Les journaux systemd** partent à la rotation de chaque machine. `journalctl --disk-usage` en donne la taille, et le premier démarrage de `journalctl --list-boots` l'horizon. Pas de purge ciblée : elle emporterait les journaux de tout le reste.
- **Les sauvegardes du conteneur** partent par nombre, pas à une date. `vzdump` les élague selon sa rétention, et `copie-dumps` garde les trois dernières copies vérifiées : la dernière trace part après trois nouvelles sauvegardes du conteneur. Une copie en échec n'est jamais élaguée (`copie-dumps/README.md`). Quand la dernière est partie, une précision datée le dit dans l'ADR-0046.

## Le Mac — à cocher, noms exacts

Pas de glob : `fr.gnaro.legion.*` emporterait le miroir, dont Mnemo se nourrit, et `relever-*.sh` emporterait la relève des copies. **Restent** : `fr.gnaro.legion.miroir`, `fr.gnaro.copie-dumps` et `relever-la-copie.sh`, ces deux derniers jusqu'à S3.

- [ ] Les tâches, déjà désactivées. Un `bootout` sur une tâche non chargée se plaint sans dommage.
  ```bash
  for t in attente rappels ronde veilleur; do launchctl bootout "gui/$(id -u)/fr.gnaro.legion.$t"; done
  ```
- [ ] Leurs fichiers :
  - `~/Library/LaunchAgents/fr.gnaro.legion.attente.plist`
  - `~/Library/LaunchAgents/fr.gnaro.legion.rappels.plist`
  - `~/Library/LaunchAgents/fr.gnaro.legion.ronde.plist`
  - `~/Library/LaunchAgents/fr.gnaro.legion.veilleur.plist`
- [ ] Leurs scripts : `~/bin/relever-la-ronde.sh`, `~/bin/relever-le-veilleur.sh`, `~/bin/relever-l-attente.sh`, `~/bin/rediger-la-note.py`, `~/bin/sonner-les-rappels.py`.
- [ ] Leurs journaux : `~/Library/Logs/legion-attente.log`, `~/Library/Logs/legion-rappels.log`, `~/Library/Logs/legion-ronde.log`, `~/Library/Logs/legion-veilleur.log`.
- [ ] Leurs caches : `~/Library/Caches/fr.gnaro.legion.ronde.verdict`, `~/Library/Caches/fr.gnaro.legion.ronde.echecs`, `~/Library/Caches/fr.gnaro.legion.veilleur.echecs`, le dossier `~/Library/Caches/legion-cloche/`.

## Les tiers — à cocher

**En L2, avant le parc :**

- [ ] **Apple** : le mot de passe d'application de Legion révoqué. Compte Apple, Connexion et sécurité, Mots de passe pour app.
- [ ] **OVH** : d'abord, dans les réglages de la boîte et pas dans les fichiers de Legion, voir qui d'autre s'y connecte avec le même identifiant (Iris). Puis changer le mot de passe de la boîte, et mettre à jour ce lecteur le même jour.

**En L4 :**

- [ ] **Le calendrier iCloud de Legion**, supprimé chez Apple (son T-003 : des événements avec le texte des rappels).
- [ ] **Le coffre** : les notes « ⚠ Messages sans réponse » et « 🔔 Rappels sonnés » effacées, de ma main. Cénacle ne touche pas au coffre.

**En L5 :** le registre de Legion fermé, « clos le <date> : données effacées » (une PR dans son dépôt), puis son dépôt archivé sur GitHub.
