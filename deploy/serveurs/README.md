# Les actions sur les serveurs (J6f — ADR-0027)

Cénacle peut, sur mon bouton confirmé dans Telegram, lancer **un script fixe** sur un serveur. Ce dossier contient ce qu'il faut poser sur chaque serveur, et la façon de relier le Mac. Rien ici ne contient de vraie adresse, de vrai nom ni de clé : `vps-b` est un nom d'exemple.

La sûreté est **sur le serveur** : un compte dédié qui n'est pas root, une clé par action qui ne sait lancer qu'un script, `sudo` pour ce script seul et sans argument, et un script qui refuse de lui-même ce qui est dangereux. Si le Mac était compromis, au pire il relancerait des services que `needrestart` désigne déjà, hors exclusions.

## Le script

`cenacle-services` relance les services qui tournent sur une bibliothèque remplacée (la liste de `needrestart`), **sauf** ce qui ne se relance pas à chaud : l'accès (`ssh`, `sshd`, `tailscaled`), les conteneurs (`docker`, `containerd`), la grappe et sa haute disponibilité (`corosync`, `pve-cluster`, `pve-ha-lrm`, `pve-ha-crm`), ce que `needrestart` épargne lui-même (`dbus`, `systemd-logind`, `getty@…`, `user@…`, les gestionnaires de réseau, `emergency`, `rescue`) — et ce que tu ajoutes dans `/etc/cenacle/services-exclus` (un nom par ligne, `nom.service`). Ceux-là restent à toi, à la main. **systemd lui-même** (`systemd-manager` dans la liste) et **les instances systemd des utilisateurs** (`systemd-user`) ne sont pas des services : ils sont laissés, notés, et se rechargent à la main (`systemctl daemon-reexec`), à la prochaine session, ou au prochain redémarrage. Tout autre nom inconnu fait refuser la liste.

Il **demande** les relances sans les attendre (`systemctl restart --no-block`) : un service lent (`cron` attend ses tâches) ne retient pas l'appel ; la preuve vient du relevé suivant de Legion, et le détail de chaque relance est dans le journal de la machine. Il ne répond que par son code de sortie : **0** relances demandées, **10** rien à relancer, **11** refusé par un garde-fou (argument passé, pas root, sortie de `needrestart` illisible, nom de service inattendu, plus de 30 services), **12** échec. Quand il laisse des services par principe (les exclusions, systemd lui-même), il en dit le nombre **n**, toujours par son seul code (ADR-0035) : **20 + n** relances demandées et n épargnés, **120 + n** rien à relancer mais n épargnés (n de 1 à 99 ; au-delà, 0 ou 10). Le Mac sait alors qu'un relevé de Legion qui compte au plus n services ne montre que les épargnés : « il ne reste que les épargnés », et non « toujours là ». **Après cette version, repose le script sur chaque machine** (`rsync` puis `install.sh`, ci-dessous) : l'ancien répond 0 ou 10, et l'opérateur garde son ancienne preuve. Chaque passage laisse une ligne : `journalctl -t cenacle`.

## Le second script : redémarrer (J6f2)

`cenacle-redemarrer` **programme** un redémarrage dans une minute (`shutdown -r +1`), et seulement si : un redémarrage est demandé (`/var/run/reboot-required`), la machine tourne depuis **24 heures** au moins, et, sur un nœud de la grappe (`pvecm` présent), la grappe a le quorum **avec tous ses nœuds** — un nœud de moins ne doit pas la faire tomber — et **aucune machine virtuelle ni aucun conteneur ne tourne encore sur le nœud** (`qm list`, `pct list`) : un redémarrage les arrêterait. Le nœud se vide à la main d'abord (migration ou arrêt), jamais par Cénacle. Codes : **0** programmé, **10** rien à faire, **11** refus d'un garde-fou, **12** échec. Pendant la minute, on peut annuler à la main sur la machine : `sudo shutdown -c`.

Il a **sa propre clé** : la clé « services » ne redémarre pas, la clé « redémarrer » ne relance pas de services.

## Le troisième script : les mises à jour de sécurité (J6f3)

`cenacle-maj-securite` **lance en tâche de fond** `unattended-upgrade` (qui n'installe que l'origine « sécurité »), dans une unité systemd à part (`cenacle-maj`) qui survit à la connexion, et répond tout de suite. **Jamais de redémarrage** : il refuse si `unattended-upgrade` est réglé pour redémarrer tout seul (`Unattended-Upgrade::Automatic-Reboot`) — le redémarrage reste ton bouton 🔄. Il refuse aussi si une mise à jour de Cénacle tourne déjà, ou s'il reste moins de 1 Go sur `/`. Codes : **0** lancée, **10** `unattended-upgrade` absent (`sudo apt install unattended-upgrades`), **11** refus, **12** échec. La mise à jour elle-même : `journalctl -u cenacle-maj`.

Sa **propre clé** aussi, `vps-b-maj`, sur le même modèle (ligne `command="sudo -n /usr/local/sbin/cenacle-maj-securite",restrict,from=…`).

## Sur le serveur, une fois

Depuis le Mac, dans le dossier de Cénacle (`ubuntu@` : le compte que tu utilises sur le VPS) :

```
rsync -a deploy/serveurs ubuntu@<vps>:cenacle-serveurs/
```

Puis sur le serveur :

```
sudo ~/cenacle-serveurs/serveurs/install.sh
```

**Il pose d'abord le garde-fou de `needrestart`** (`/etc/needrestart/conf.d/zz-cenacle.conf`, `restart = 'l'`) : sans lui, le crochet apt de `needrestart` relance de lui-même tout service lié à une bibliothèque mise à jour (ADR-0040, d'après Legion). Si `needrestart` manque, il s'arrête là, garde-fou posé : installe-le (`sudo apt install needrestart`), puis relance `install.sh`.

Il crée ensuite le compte `cenacle` (sans mot de passe), pose les scripts dans `/usr/local/sbin`, le bulletin dans `/usr/local/bin`, la liste d'exclusions dans `/etc/cenacle/`, et les règles `sudo` dans `/etc/sudoers.d/cenacle` — vérifiées par `visudo` avant de prendre effet, **puis une à une** : chaque forme permise doit passer, toute autre (`needrestart -r a -b`, `pvecm add`, un argument de plus…) doit être refusée ; au moindre doute, il retire `/etc/sudoers.d/cenacle` et le dit. Le relancer est sans danger.

## Sur le Mac, une clé par action et par machine

```
mkdir -p -m 700 ~/.ssh/cenacle
ssh-keygen -t ed25519 -N "" -C "cenacle vps-b services" -f ~/.ssh/cenacle/vps-b-services
```

La clé n'a pas de phrase de passe (l'opérateur tourne seul) : elle est protégée par FileVault et par ses droits (`600`, l'opérateur refuse une clé lisible par un autre). Elle ne sait lancer qu'un script, depuis le Mac seulement.

Sur le serveur, ajoute **une ligne** à `~cenacle/.ssh/authorized_keys` — la clé publique (`vps-b-services.pub`) précédée de ses verrous ; `<adresse Tailscale du Mac>` est l'adresse `100.x.y.z` du Mac :

```
command="sudo -n /usr/local/sbin/cenacle-services",restrict,from="<adresse Tailscale du Mac>" ssh-ed25519 AAAA… cenacle vps-b services
```

Épingle l'empreinte du serveur dans un `known_hosts` à Cénacle, et **compare-la** à celle que le serveur donne lui-même (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, sur le serveur) :

```
ssh-keyscan -t ed25519 <vps> > ~/.ssh/cenacle/known_hosts
ssh-keygen -lf ~/.ssh/cenacle/known_hosts
```

Pour le redémarrage, une **seconde clé** et une **seconde ligne**, verrouillée sur l'autre script :

```
ssh-keygen -t ed25519 -N "" -C "cenacle vps-b redemarrer" -f ~/.ssh/cenacle/vps-b-redemarrer
```

```
command="sudo -n /usr/local/sbin/cenacle-redemarrer",restrict,from="<adresse Tailscale du Mac>" ssh-ed25519 AAAA… cenacle vps-b redemarrer
```

## Le bulletin, pour l'onglet « Parc » (ADR-0039)

`cenacle-bulletin` **récite** l'état de la machine entre `bulletin=1` et `fin=1`, porté du bulletin de Legion. Version 2 (ADR-0040) : les mesures que montre la page — charge, processeurs, mémoire, disques — et ce que la ronde jugera : redémarrage requis (`redemarrage`), mises à jour en attente (`maj.total`, `maj.securite`), services sur une bibliothèque remplacée (`services.a_relancer`, leur nombre seulement), quorum de la grappe sur un nœud (`grappe.quorum`, `grappe.votes`, `grappe.attendus`), ports en écoute (`ports`, la portée — `local/`, `tailnet/` ou rien — jamais l'adresse). **Ce qui n'a pas pu être lu n'est pas récité**, jamais mis à 0.

Il est **en lecture seule** : il n'écrit rien, ne change rien. Il passe par `sudo` pour deux commandes seulement, figées avec leurs arguments dans `/etc/sudoers.d/cenacle` : `/usr/sbin/needrestart -r l -b` (lister, jamais relancer) et, sur un nœud, `/usr/bin/pvecm status`. `install.sh` le pose dans `/usr/local/bin`.

**Passer une machine à la version 2** : le Mac lit déjà les deux versions. Depuis le Mac, `rsync` comme plus haut, puis `install.sh` sur la machine ; l'essai ci-dessous doit montrer `version=2` et la ligne `redemarrage=` (sur un nœud, aussi `grappe.quorum=oui`). Une machine à la fois : l'onglet « Parc » doit la montrer lisible avant de passer à la suivante.

**Version 3 (ADR-0043) : les sauvegardes.** Le bulletin récite aussi, pour chaque verdict de sauvegarde présent sur la machine — `copie-dumps`, `veiller-sauvegardes`, `copie-bases`, `myriade-base` et, depuis l'ADR-0044 (B2), `copie-cenacle`, sous `/var/lib/<source>/verdict` —, son état (`sauvegarde.<source>.verdict=SAIN|MALADE`), son heure (`.instant`), depuis quand il est malade (`.depuis`, absent quand il est sain) et **le nombre** de ses motifs (`.motifs`) : **jamais le texte d'un motif**, qui porte des adresses et des noms d'hôtes. Le détail se lit sur la machine : `sudo cat /var/lib/<source>/verdict`. Un verdict hors de la forme de sa source, un lien symbolique, un fichier que le compte `cenacle` ne peut pas lire se récitent `sauvegarde.<source>.lecture=illisible`, jamais comme un verdict. **Sans `sudo`** : le compte lit ces fichiers comme n'importe quel compte.

**Avant de passer une machine à la version 3**, vérifier que le compte les lit (un « No such file » est normal pour une source qui n'est pas sur cette machine) :

```
for s in copie-dumps veiller-sauvegardes copie-bases myriade-base copie-cenacle; do printf '%s : ' "$s"; sudo -u cenacle head -1 /var/lib/$s/verdict 2>&1; done
```

Un « Permission denied » se corrige **chez l'écrivain**, pas sur le fichier, que le passage suivant remplace : une surcharge `UMask=0022` de son unité systemd, ou le droit de lecture sur son dossier. Refaire la vérification après une nuit. Puis `rsync` et `install.sh` comme pour la version 2 ; l'essai doit montrer `version=3` et, sur une machine qui en porte, des lignes `sauvegarde.`. Le Mac lit les trois versions.

Sa **propre clé**, jamais une clé d'action (une clé qui met à jour ou redémarre ne sert pas à regarder) :

```
ssh-keygen -t ed25519 -N "" -C "cenacle vps-b bulletin" -f ~/.ssh/cenacle/vps-b-bulletin
```

```
command="/usr/local/bin/cenacle-bulletin",restrict,from="<adresse Tailscale du Mac>" ssh-ed25519 AAAA… cenacle vps-b bulletin
```

L'essai, depuis le Mac — attendu : des lignes `clé=valeur`, de `bulletin=1` à `fin=1` :

```
ssh -T -F /dev/null -i ~/.ssh/cenacle/vps-b-bulletin -o IdentitiesOnly=yes -o UserKnownHostsFile=~/.ssh/cenacle/known_hosts -l cenacle <vps>
```

Puis copie `parc.local.example.toml` en `parc.local.toml` (ignoré par git), une ligne `[[machine]]` par machine : la ronde le relit à chaque passage, sans redémarrage (ADR-0040). Un fichier **à part** de `serveurs.local.toml` : la ronde ne voit jamais une clé d'action, l'opérateur reste seul à les connaître.

Pour chaque machine, déclare aussi ce que la ronde doit trouver : `hote`, le nom qu'elle récite (la ligne `hote=` de l'essai ci-dessus), et `ports`, les ports qu'elle doit écouter, écrits comme le bulletin les récite (`tcp/22`, `local/tcp/25`, `tailnet/udp/41641`, et les trois jokers de Legion). Tant qu'ils manquent, la machine est SOUFFRANTE — « rien n'est contrôlé » —, jamais SAINE par défaut. Un port qui écoute sans être déclaré la rend MALADE ; un port déclaré absent, SOUFFRANTE.

## L'essai à la main, avant tout bouton

Depuis le Mac (`<vps>` : son nom Tailscale) :

```
ssh -T -F /dev/null -i ~/.ssh/cenacle/vps-b-services -o IdentitiesOnly=yes -o UserKnownHostsFile=~/.ssh/cenacle/known_hosts -l cenacle <vps>; echo "code $?"
```

Attendu : `code 10` (rien à relancer) ou `code 0` (relancé). Pour le redémarrage, la même commande avec la clé `vps-b-redemarrer` : **attention, si un redémarrage est demandé, il sera programmé pour de vrai** (code 0) — `sudo shutdown -c` sur la machine dans la minute pour l'annuler. Sans redémarrage demandé : `code 10`. Puis la preuve que la clé ne sait rien faire d'autre — la même commande suivie de `ls` doit **encore** lancer le script (même code, aucune liste de fichiers) ; et `-t` à la place de `-T` doit refuser le terminal. Sur le serveur, `journalctl -t cenacle` montre chaque passage.

## Relier l'opérateur

Copie `serveurs.local.example.toml` en `serveurs.local.toml` (ignoré par git) et remplis-le : le nom de la machine **tel que la ronde de Legion l'écrit**, son adresse, le compte `cenacle`, le chemin de chaque clé (`cles = { services = "…", redemarrer = "…", maj_securite = "…" }` — une action sans clé n'est jamais lancée), le `known_hosts`. Puis, dans le dossier de Cénacle :

```
npm run service -- install operateur
```

**Après chaque modification de `serveurs.local.toml`** :

```
npm run serveurs:verifier
```

Il relit le fichier comme l'opérateur : la liste des machines et de leurs actions, ou l'erreur exacte (numéro du bloc compris), code 1. Le fichier est strict — une clé inconnue (une liste `ports` de Legion collée là, par exemple) ou une machine sans `cles` font refuser **toutes** les actions jusqu'à correction ; une machine sur laquelle on n'agit pas n'y figure pas. Sur Telegram, le refus dit la sorte d'erreur, jamais le détail.

Rien ne part tant que `[serveurs] actif = false` dans `securite.toml` : on l'active par une PR, au moment de l'essai par le bouton (J6f1b).

## La copie de la base : le serveur de sauvegarde (ADR-0044, B1c)

Chaque nuit, le Mac pousse une copie chiffrée de quatre tables de la base (`deploy/launchd/README.md`). Le **serveur de sauvegarde seul** la reçoit, par un compte à part, **`cenacle-depot`**, qui n'est pas `cenacle` : la clé qui dépose ne sert ni à regarder ni à agir.

- **Le compte** n'a ni mot de passe, ni groupe autre que le sien, ni `sudo`. Sa maison et son `authorized_keys` sont à root : la clé ne peut pas changer sa propre serrure.
- **Le dépôt**, `/var/backups/cenacle-copie` : `arrivee/` (au compte : la clé y écrit, rien d'autre), `examen/`, `gardees/` et `refusees/` (à root seul). Le dossier lui-même peut être un **lien vers un volume à part** : une clé volée ne remplirait alors que ce volume ; les quatre dossiers dessous, jamais des liens.
- **Le minuteur `veiller-copie-cenacle`**, toutes les heures, en root mais enfermé (sans réseau, `/usr` et `/etc` en lecture seule) :
  - il sort chaque arrivée de la portée du compte **avant** de la regarder, la juge dans **une copie à lui** (un fichier neuf, à root : ce que le compte garderait ouvert ou lié ne l'atteint pas), et la garde sous **l'heure d'arrivée du serveur**, écrite dans son nom — jamais la date du fichier ;
  - il **refuse** (quarantaine, `refusees/`) : un nom qui n'est pas celui d'une copie, ce qui n'est pas un fichier ordinaire, plus de 1 Go, un fichier vide, sans en-tête `age`, un transfert inachevé depuis 6 h ;
  - il **garde et signale** une deuxième copie moins de 12 h après une autre : refusée, une fausse copie poussée avant la vraie avec une clé volée ferait refuser la vraie ; gardées, aucune n'évince l'autre ;
  - il **efface** les copies arrivées depuis plus de 7 jours, **sauf la plus récente**, et la quarantaine après 7 jours ;
  - il écrit le **verdict** `/var/lib/copie-cenacle/verdict` (format commun : `verdict`, `instant`, `depuis`, `gardes`, `refusees`, `derniere`, `motif`, `fin=1`), lisible par le compte `cenacle` pour le bulletin (B2). **MALADE** : aucune copie gardée, la plus récente arrivée il y a plus de 36 h, plus d'une copie arrivée à moins de 12 h de la plus récente, une arrivée qui n'a pas pu être examinée, une horloge en retard sur une arrivée déjà rangée (rien n'est alors effacé), ou un refus au moins aussi récent que la copie la plus récente — la copie suivante, seule dans sa nuit, lève ces deux derniers ; la quarantaine reste 7 jours pour que tu la regardes : `sudo ls -l /var/backups/cenacle-copie/refusees` (chaque nom dit l'heure d'arrivée et la raison).

### Sur le serveur de sauvegarde, une fois

Si tu veux le dépôt sur le volume des sauvegardes, crée-le d'abord, puis le lien (sinon, `install-copie.sh` le crée sur le disque de `/var`) :

```
sudo install -d -m 0711 /srv/sauvegardes/cenacle-copie
sudo ln -sn /srv/sauvegardes/cenacle-copie /var/backups/cenacle-copie
```

`-n` : relancée, la commande refuse (« File exists ») ; sans lui, elle suivrait le lien déjà posé et en mettrait un second **dans** le dépôt, pointant sur lui-même.

Le compte doit **traverser** chaque dossier jusqu'à son arrivée, et un volume de sauvegardes est souvent fermé à tout autre que root. `install-copie.sh` le vérifie, comme le compte, et nomme le dossier qui l'arrête. Laisse-le alors passer, et rien de plus (ni lire ni lister ; paquet `acl`) — jamais `chmod o+x`, qui ouvrirait le passage à tous les comptes :

```
sudo setfacl -m u:cenacle-depot:--x /srv/sauvegardes
```

Puis, depuis le Mac, `rsync` comme plus haut, et sur le serveur :

```
sudo ~/cenacle-serveurs/serveurs/install-copie.sh
```

Il vérifie `rrsync` (rsync 3.2.4 au moins) et `python3`, crée le compte et le dépôt, vérifie que le compte atteint son arrivée, pose le minuteur et le lance une première fois : son verdict dit alors `aucune copie gardée`, c'est attendu. Il prévient si `sshd` ne laisse entrer que certains comptes (`AllowUsers`, `AllowGroups`) : ajoute alors `cenacle-depot`. Le relancer est sans danger.

### La clé de poussée

Sur le Mac (`deploy/launchd/README.md`) :

```
ssh-keygen -t ed25519 -N "" -C cenacle-copie -f ~/.ssh/cenacle/copie-pousser
```

Sur le serveur, **une ligne** dans `/home/cenacle-depot/.ssh/authorized_keys` (`sudo`, le fichier est à root), la clé publique précédée de ses verrous :

```
restrict,from="<adresse Tailscale du Mac>",command="/usr/bin/rrsync -wo -no-del -no-overwrite /var/backups/cenacle-copie/arrivee" ssh-ed25519 AAAA… cenacle-copie
```

Le `known_hosts` de Cénacle porte déjà l'empreinte du serveur s'il a une clé d'action ou de bulletin ; sinon, épingle-la comme plus haut. Puis `copie.local.toml` sur le Mac, et l'essai :

```
npm run copie
```

Attendu : « ✔ Copie de la base : poussée ». Dans l'heure, sur le serveur, `sudo cat /var/lib/copie-cenacle/verdict` doit dire `verdict=SAIN`. Alors seulement : `npm run service -- install copie` sur le Mac.

**Le bulletin récite ce verdict** (ADR-0044, B2) — `sauvegarde.copie-cenacle.verdict`, `.instant`, `.depuis`, `.motifs`, jamais le texte d'un motif — une fois le Mac à jour **d'abord** (il doit connaître la source, sinon le bulletin entier lui est illisible), puis le script reposé sur le serveur de sauvegarde : `rsync` et `install.sh` comme plus haut. L'essai du bulletin doit alors montrer les lignes `sauvegarde.copie-cenacle.`. La ronde ne le juge qu'avec S2 (ADR-0043), après sa bascule.

**Clé perdue ou volée** : retire sa ligne de `authorized_keys`, regarde la quarantaine et les copies gardées depuis la date du vol (une fausse copie chiffrée pour une autre clé ne se voit qu'à la restauration), tire une nouvelle clé, remets une ligne.
