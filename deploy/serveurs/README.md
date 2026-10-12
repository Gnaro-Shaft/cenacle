# Les actions sur les serveurs (J6f — ADR-0027)

Cénacle peut, sur mon bouton confirmé dans Telegram, lancer **un script fixe** sur un serveur. Ce dossier contient ce qu'il faut poser sur chaque serveur, et la façon de relier le Mac. Rien ici ne contient de vraie adresse, de vrai nom ni de clé : `vps-b` est un nom d'exemple.

La sûreté est **sur le serveur** : un compte dédié qui n'est pas root, une clé par action qui ne sait lancer qu'un script, `sudo` pour ce script seul et sans argument, et un script qui refuse de lui-même ce qui est dangereux. Si le Mac était compromis, au pire il relancerait des services que `needrestart` désigne déjà, hors exclusions.

## Le script

`cenacle-services` relance les services qui tournent sur une bibliothèque remplacée (la liste de `needrestart`), **sauf** ce qui ne se relance pas à chaud : l'accès (`ssh`, `sshd`, `tailscaled`), les conteneurs (`docker`, `containerd`), la grappe et sa haute disponibilité (`corosync`, `pve-cluster`, `pve-ha-lrm`, `pve-ha-crm`), ce que `needrestart` épargne lui-même (`dbus`, `systemd-logind`, `getty@…`, `user@…`, les gestionnaires de réseau, `emergency`, `rescue`) — et ce que tu ajoutes dans `/etc/cenacle/services-exclus` (un nom par ligne, `nom.service`). Ceux-là restent à toi, à la main. **systemd lui-même** (`systemd-manager` dans la liste) et **les instances systemd des utilisateurs** (`systemd-user`) ne sont pas des services : ils sont laissés, notés, et se rechargent à la main (`systemctl daemon-reexec`), à la prochaine session, ou au prochain redémarrage. Tout autre nom inconnu fait refuser la liste.

Il **demande** les relances sans les attendre (`systemctl restart --no-block`) : un service lent (`cron` attend ses tâches) ne retient pas l'appel ; la preuve vient du relevé suivant de Legion, et le détail de chaque relance est dans le journal de la machine. Il ne répond que par son code de sortie : **0** relances demandées, **10** rien à relancer, **11** refusé par un garde-fou (argument passé, pas root, sortie de `needrestart` illisible, nom de service inattendu, plus de 30 services), **12** échec. Chaque passage laisse une ligne : `journalctl -t cenacle`.

## Le second script : redémarrer (J6f2)

`cenacle-redemarrer` **programme** un redémarrage dans une minute (`shutdown -r +1`), et seulement si : un redémarrage est demandé (`/var/run/reboot-required`), la machine tourne depuis **24 heures** au moins, et, sur un nœud de la grappe (`pvecm` présent), la grappe a le quorum **avec tous ses nœuds** — un nœud de moins ne doit pas la faire tomber. Codes : **0** programmé, **10** rien à faire, **11** refus d'un garde-fou, **12** échec. Pendant la minute, on peut annuler à la main sur la machine : `sudo shutdown -c`.

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
sudo apt install needrestart
sudo ~/cenacle-serveurs/serveurs/install.sh
```

Il crée le compte `cenacle` (sans mot de passe), pose le script dans `/usr/local/sbin`, la liste d'exclusions dans `/etc/cenacle/`, et la règle `sudo` dans `/etc/sudoers.d/cenacle` — vérifiée par `visudo` avant de prendre effet. Le relancer est sans danger.

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

Rien ne part tant que `[serveurs] actif = false` dans `securite.toml` : on l'active par une PR, au moment de l'essai par le bouton (J6f1b).
