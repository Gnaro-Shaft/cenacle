# ADR-0040 — La ronde de Cénacle : ses propres bulletins, sans Legion

**Statut** : acceptée (2026-11-15) — remplace, à terme, le pont avec la ronde de Legion (ADR-0025) ; révise l'ADR-0027 (la preuve par « le relevé de Legion ») et l'ADR-0039 (qui lit les bulletins, et quand)

## Contexte

Cénacle remplacera Legion (10/10, redit le 14/11). Aujourd'hui, il ne sait rien de l'état de mes serveurs sans lui :

- **l'agent sécurité** tire tous ses constats sur les serveurs du verdict de Legion (`parse-legion.ts`) : redémarrage requis, mises à jour de sécurité en attente, services sur une bibliothèque remplacée, ports inattendus ou absents, disque plein, grappe sans quorum ;
- **l'opérateur** (ADR-0027) n'agit que si « le dernier relevé de Legion a moins de 35 minutes et montre encore le problème », et prouve le résultat d'une action par les relevés suivants ; le plan de maintenance (ADR-0035) fait de même ;
- tous deux lisent la **copie du verdict** que Legion dépose sur le Mac toutes les 15 minutes.

Legion arrêté, Cénacle devient aveugle sur les serveurs, et l'opérateur refuse toute action. C'est le dernier lien fort ; le reste de Legion (sa maison, ses délégations, sa porte) a déjà son équivalent dans Cénacle ou n'a pas d'objet ici.

Cénacle a déjà la moitié du chemin (ADR-0039) : un bulletin à lui, `cenacle-bulletin`, porté du `legion-bulletin-hote` de Legion, posé sur quatre serveurs, dont les deux nœuds Proxmox, lu par une clé verrouillée sur ce seul script. Il ne récite que des **mesures** (charge, mémoire, disques) : rien de ce que l'agent sécurité et l'opérateur jugent.

Ce que Legion fait, et que cet ADR reprend (étudié le 15/11 dans son code et ses ADR 015, 025, 029 et 031) :

- **Le bulletin** (son ADR-029) récite, en lecture seule, entre `bulletin=1` et `fin=1`, en nombres entiers : `redemarrage=requis|non` (présence de `/var/run/reboot-required`) ; les mises à jour de sécurité en attente (`apt-check` sur Ubuntu ; sur Debian et Proxmox, `apt-get -s dist-upgrade` sans verrou, lignes `Inst` dont l'origine contient « security ») ; les services à relancer (`sudo -n needrestart -r l -b`, lignes `NEEDRESTART-SVC` ; **une commande en échec ne compte jamais pour 0** : la clé est omise) ; le quorum de la grappe (`pvecm status`) ; les ports en écoute (`ss -H -lntu` lu **deux fois**, à une seconde d'écart, pour écarter les sockets UDP éphémères ; l'adresse est classée — locale, tailnet, autre — **jamais récitée**).
- **Le jugement** (`regles.py`) : trois états, SAIN, SOUFFRANT, MALADE — le pire l'emporte ; des motifs en clair, dont les formulations sont devenues un contrat (Cénacle les reconnaît par expressions régulières). Disque ≥ 80 % SOUFFRANT, ≥ 90 % MALADE (réglables par machine) ; port inattendu MALADE, port attendu absent SOUFFRANT ; grappe sans quorum MALADE ; **ce qui n'a pas pu être lu est SOUFFRANT ou MALADE, jamais SAIN** (son ADR-025 : « ce qu'on ne peut pas juger est une alerte »).
- **Le verdict** : un fichier `etat=`, `instant=`, `hotes=`, `<hôte>.etat=`, `<hôte>.motifN=`, `fin=1`, écrit d'un bloc (fichier temporaire puis renommage), même quand tout est sain — l'instant est le battement.
- **Les écueils qu'il a payés** : `needrestart` hors du `PATH` d'un compte ordinaire ; le crochet apt de `needrestart` qui relance tout par défaut (`$nrconf{restart}='l'` à poser avant) ; les ports UDP éphémères de `tailscaled` (d'où la double lecture) ; les ports locaux aléatoires d'un serveur de modèle (d'où `local/tcp/*`) ; un pic de disque pendant une copie de sauvegarde (d'où deux relevés consécutifs avant de proposer quoi que ce soit — Cénacle le fait déjà : un constat n'est ouvert qu'à sa deuxième observation).

## Décision

1. **Le bulletin récite aussi ce qu'on juge** (`cenacle-bulletin`, version 2), en reprenant les commandes de Legion et en le citant :
   - `redemarrage`, `maj.securite` (et `maj.total`), `services.a_relancer`, `grappe.quorum` avec ses votes sur un nœud Proxmox, `ports` ;
   - une valeur qui n'a pas pu être lue est **omise**, jamais mise à 0 ;
   - **toujours rien** de ce qui touche des personnes : ni journaux, ni noms d'utilisateurs, ni adresses — ni les compteurs de fail2ban et de refus SSH que récite Legion, qui portent sur des adresses de tiers ;
   - **deux règles `sudo` de plus, en lecture seule et sans argument libre**, pour le compte `cenacle` : `needrestart -r l -b` (le mode liste, qui ne relance rien) et, sur un nœud, `pvecm status`. C'est un écart à l'ADR-0039 (« sans sudo ») : sans elles, ni les services à relancer ni le quorum ne se lisent. Le crochet apt de `needrestart` est réglé en `restart='l'` par `install.sh`, avant tout.

2. **Une ronde, programme à part, seul lecteur des bulletins.** `ronde`, lancé par launchd **toutes les 5 minutes** (Legion : 15), verrou d'instance :
   - il lit le bulletin de chaque machine de `parc.local.toml`, avec ses clés de lecture, son `known_hosts` épinglé, ses délais (20 s de connexion, 60 s en tout) ;
   - il **juge avec les règles de Legion et ses formulations exactes** : les motifs restent le contrat que l'agent sécurité et l'opérateur lisent déjà ;
   - les **ports attendus** et les seuils de disque se déclarent par machine dans `parc.local.toml` (non versionné), avec les trois seuls jokers de Legion (`tailnet/tcp/*`, `tailnet/udp/*`, `local/tcp/*` au-delà de 32768) ; une machine sans ports déclarés est SOUFFRANTE (« rien n'est contrôlé »), jamais saine par défaut ;
   - il écrit **le verdict au format de Legion**, d'un bloc, en mode 600, dans le cache de Cénacle, et **le dernier bulletin de chaque machine** pour la page ; rien d'autre, rien d'historisé : chaque passage écrase le précédent.

   C'est lui, et non plus le serveur de la page, qui détient les clés de lecture : **l'exception `ssh` de l'ADR-0039 passe du serveur à la ronde**, toujours dans un seul fichier, vérifiée par le même test de frontière. La page lit le fichier de la ronde, plus aucune machine : ses mesures ont au plus 5 minutes au lieu d'une.

3. **Une bascule, pas un saut.** `securite.toml` dit d'où l'agent sécurité et l'opérateur lisent le verdict : `[ronde] source = "legion"` (par défaut, au départ) ou `"cenacle"`.
   - **Pendant au moins sept jours**, les deux rondes tournent ; l'agent sécurité compare les deux verdicts à chaque passage et dit une seule fois chaque différence (une machine, un motif, de part ou d'autre).
   - Quand les différences sont expliquées, **je** bascule la source par une PR ; un retour arrière est la même ligne.
   - Legion s'arrête ensuite, par moi. La ronde de Cénacle reprend la machine qui héberge Legion, avec le bulletin et la clé posés comme ailleurs.

4. **Les garde-fous de l'ADR-0027 ne changent pas de nature.** L'opérateur exige toujours un verdict de moins de 35 minutes qui montre encore le problème ; ses messages disent « le relevé » au lieu de « le relevé de Legion ». Avec une ronde toutes les 5 minutes, la preuve après un redémarrage arrive plus tôt ; les délais de l'ADR-0027 (3 minutes après, 30 minutes pour revenir) restent.

5. **Une ronde silencieuse est une alerte.** Un verdict de plus de 20 minutes (quatre passages manqués) ou daté du futur devient un constat de l'agent sécurité, comme celui de Legion aujourd'hui ; un bulletin illisible rend la machine MALADE avec la raison, jamais SAINE.

6. **Aucune donnée personnelle, aucun tiers, aucune IA.** Des faits de machines (compteurs, ports sans adresse, états). Le verdict et les bulletins vivent sur le Mac, écrasés à chaque passage : rien à purger. Aucun modèle ne juge, n'écrit ni ne lit ces fichiers.

7. **Tests adversariaux exigés** : un bulletin tronqué, en double, hors forme ou d'un autre hôte rend MALADE, jamais SAIN ; une commande en échec n'est jamais un 0 ; un port inattendu, un joker hors des trois permis, une machine sans ports déclarés ; les formulations des motifs identiques à celles de Legion (un même bulletin, jugé par les deux règles, donne les mêmes motifs) ; le verdict écrit d'un bloc ; la ronde seule à lancer `ssh` avec les clés de lecture, l'opérateur seul avec les clés d'action ; la source `cenacle` choisie sans verdict de Cénacle refuse toute action.

## Paliers

- **R0** — cet ADR, pour relecture.
- **R1** — le bulletin version 2 et son lecteur strict ; `install.sh` pose les deux règles `sudo` et le réglage de `needrestart`. À installer par moi sur chaque machine ; la page n'en montre rien de plus.
- **R2** — le programme `ronde` : lecture, jugement, verdict et bulletins écrits ; la page lit son fichier ; l'exception `ssh` déplacée.
- **R3** — la source dans `securite.toml`, la comparaison des deux verdicts, les messages de l'opérateur. *Fait le 2026-11-16 ; la page nomme aussi la source de son verdict.*
- **R4** — après sept jours et ma bascule : la machine de Legion dans la ronde, Legion arrêté par moi, `legion_ronde` et son chemin retirés du code.

## Conséquences

- Cénacle voit ses serveurs sans Legion, et l'opérateur peut agir sans lui ; Legion peut s'arrêter.
- **Un accès qui grandit un peu** : la clé de lecture fait désormais lancer deux commandes par `sudo`, en lecture seule. Volée, elle montre davantage de la machine (ses ports en écoute, sans adresse ; ses mises à jour en retard), elle ne la change toujours pas.
- **Un programme de plus** sous launchd, toutes les 5 minutes : une connexion SSH par machine, et une simulation `apt-get` sur chacune — quelques secondes de processeur par passage.
- Les ports attendus, déclarés aujourd'hui dans la configuration de Legion, sont à recopier dans `parc.local.toml` : par moi, puisque ce fichier n'est pas versionné et que je ne lis pas celle de Legion.
- Travail : le bulletin et l'installation (`deploy/serveurs`), le programme `ronde` et ses règles, la lecture par la page, la source et la comparaison, les tests ; une révision des ADR-0025, 0027 et 0039 au fil des paliers.

## Options écartées

- **L'agent sécurité fait la ronde lui-même** : un programme de moins, mais un deuxième détenteur de clés SSH, dans un programme qui lit des contenus publics (bulletins du CERT-FR, avis npm) ; et il ne tourne que toutes les 15 minutes.
- **Le serveur de la page garde la lecture et écrit le verdict** : il détient déjà les clés de lecture, mais il ne lit que quand la page est ouverte ; en faire aussi une ronde mêlerait un serveur web et une tâche planifiée.
- **Une ronde qui lit, et le serveur qui lit aussi en direct** : des mesures à la minute, mais deux détenteurs des mêmes clés pour un gain d'affichage.
- **Un verdict à un format nouveau** : plus propre, mais l'agent sécurité, l'opérateur, le plan de maintenance et leurs tests lisent déjà celui de Legion ; le garder rend la bascule réversible d'une ligne.
- **Prometheus et `node_exporter`** : des métriques riches, mais un service de plus, ouvert sur chaque machine, et rien qui juge ; Legion a montré qu'un bulletin récité suffit.
- **Garder Legion pour la ronde seule** : l'objet même de la décision du 10/10.
