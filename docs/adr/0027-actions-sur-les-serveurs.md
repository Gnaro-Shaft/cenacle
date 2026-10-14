# ADR-0027 — Agir sur les serveurs : un catalogue fermé, mon bouton, des garde-fous sur le serveur

**Statut** : acceptée (2026-10-11) — jalon J6f de la phase 6 ; révise l'ADR-0025 (le pont : « Cénacle ne se connecte à aucun serveur »)

## Contexte

L'agent sécurité voit les serveurs par le pont avec la ronde de Legion (ADR-0025) : un noyau corrigé qui attend un redémarrage, des services qui tournent sur une bibliothèque remplacée, des mises à jour de sécurité en attente. Aujourd'hui il ne peut que me donner la commande à lancer moi-même. Le dirigeant veut davantage (2026-10-11) : **sur le terrain, loin de son poste, pouvoir déclencher depuis Telegram le redémarrage d'un serveur après une mise à jour**, avec des garde-fous. Cénacle doit devenir un véritable assistant ; il aura à terme son propre serveur.

Legion avait écarté toute action sur les serveurs : sa ronde « n'agit pas », et pour une machine malade il propose une commande fixe que je lance à la main (son ADR-029, `propositions/machines.py`). Cet ADR va plus loin, sans renoncer à ce qui faisait la sûreté de Legion : un catalogue fermé, jamais une commande écrite par un modèle, une clé qui ne sait faire qu'une chose.

La menace qui guide la conception : **le Mac, ou mon compte Telegram, compromis**. Les garde-fous du Mac tombent avec lui ; ceux du serveur restent. La protection qui compte est donc **sur le serveur**.

## Décision

1. **Un catalogue fermé d'actions, chacune un script fixe posé par moi sur le serveur.** Trois actions, livrées l'une après l'autre :
   - `cenacle-services` — relancer les services qui tournent sur une bibliothèque remplacée (`needrestart`) ;
   - `cenacle-redemarrer` — redémarrer la machine ;
   - `cenacle-maj-securite` — appliquer les mises à jour de sécurité seules, **sans jamais redémarrer**.

   Aucun agent n'écrit, ne choisit ni ne complète une commande ; aucun argument ne passe du Mac au script. Le texte d'un constat ne devient jamais une commande (charte, règle 1).

2. **Sur chaque serveur, des garde-fous qui ne dépendent pas du Mac.**
   - Un compte dédié `cenacle`, sans mot de passe, sans shell utile, **jamais root**.
   - **Une clé SSH par action**, verrouillée dans `authorized_keys` : `command="sudo /usr/local/sbin/cenacle-<action>",restrict,from="<adresse Tailscale du Mac>"`. Volée, une clé ne lance qu'un seul script, et seulement depuis le Mac ; ni shell, ni redirection, ni terminal.
   - Une règle `sudo` qui autorise **ce script précis**, sans argument, et rien d'autre.
   - **Le script refuse de lui-même** ce qui est dangereux, quoi que dise le Mac :
     - `cenacle-redemarrer` : refuse si aucun redémarrage n'est demandé (`/var/run/reboot-required` absent), si la machine a redémarré depuis moins de 24 heures, et, sur la grappe, si un autre nœud manque ou si les votes restants pendant son absence ne feraient plus une majorité stricte (le quorum serait perdu — ajouté le 2026-10-13 : sur deux nœuds sans QDevice, aucun redémarrage n'est jamais accepté) ;
     - `cenacle-services` : demande les relances sans les attendre (`--no-block`, depuis le premier vrai passage du 2026-10-11 : `cron` a mis 90 secondes, l'appel a dépassé les 2 minutes de l'opérateur ; un appel coupé se dit désormais « état inconnu », jamais « injoignable ») ; ne relance que ce que `needrestart` désigne, jamais le démon SSH ni le service qui porte la grappe (révisé le 2026-10-11, sur la première vraie liste d'un nœud Proxmox : ni la haute disponibilité `pve-ha-*`, ni ce que `needrestart` épargne lui-même — `dbus`, `systemd-logind`, sessions, réseau — ; systemd lui-même, `systemd-manager`, laissé au lieu de faire refuser toute la liste ; de même `systemd-user`, les instances des utilisateurs, vu le 2026-10-12 sur un second nœud ; tout autre nom inconnu refuse toujours la liste) ;
     - `cenacle-maj-securite` : n'installe que l'origine « security », ne redémarre jamais.
   - Chaque exécution laisse une trace dans le journal système du serveur (`logger -t cenacle`), refus compris.

3. **Sur le Mac, mon bouton, confirmé.**
   - Sous un constat serveur venu du pont, et seulement pour l'action qui y répond (un redémarrage demandé → 🔄 Redémarrer ; des services à relancer → 🔁 Relancer les services), un bouton à jeton unique.
   - Mon appui ne déclenche rien : le bot me demande **« Confirmer … sur noeud-a ? »**, avec un second bouton à usage unique, **valable 2 minutes** (60 secondes à l'origine, portées à 2 minutes le 2026-10-11 : la première confirmation réelle est arrivée trop tard). Un appui égaré, ou un message vieux, ne suffit pas.
   - La demande confirmée est seulement **enregistrée** ; le bot ne détient aucune clé.

4. **Un programme à part, `operateur`, seul détenteur des clés.** Lancé par launchd chaque minute, verrou d'instance (ADR-0023). Il ne détient que la famille de secrets `serveurs` (les chemins des clés, un `known_hosts` à lui, `StrictHostKeyChecking=yes`), plus de quoi me répondre sur Telegram. Ni le CTO, ni le bot, ni l'agent sécurité ne lisent les clés.
   - **Avant d'agir, il revérifie** (charte, règle 5) : le dernier relevé de Legion a moins de **35 minutes** et montre **encore** le problème (20 minutes à l'origine : la ronde de Legion et sa recopie sur le Mac tournant chacune toutes les 15 minutes, le relevé disponible a jusqu'à ~30 minutes en temps normal — l'essai du 2026-10-11 a été refusé à 25 minutes ; 35 reste plus strict que les 45 de l'agent sécurité) ; sinon rien n'est fait, et il me dit pourquoi.
   - **Une seule action à la fois**, toutes machines confondues ; au plus un redémarrage par machine et par 24 heures (le script le refuse aussi).
   - Le code de sortie du script et la règle qui a refusé, s'il y en a une, me sont dits ; jamais une sortie brute du serveur.

5. **Après coup, la preuve.** (2026-10-12 : pour les services, l'opérateur garde ce que Legion comptait avant et après ; moins qu'avant sans être à zéro — les épargnés restent — se dit « réduit », non « encore là ».) Les relevés suivants de Legion doivent montrer la machine revenue et le problème disparu : le résultat m'est dit. Une machine **qui ne revient pas en 30 minutes** est une alerte critique, de jour comme de nuit.

6. **Jamais délégable, jamais déclenché par un agent.** Comme la fusion (ADR-0026), aucune de ces actions n'entre dans les délégations ; un agent ne peut que montrer le bouton. **Aucun modèle** n'intervient : ni pour proposer l'action (le catalogue répond au type de constat), ni pour la décider, ni pour juger du résultat.

7. **Un interrupteur général** : `[serveurs] actif = false` dans `securite.toml` (versionné) coupe tout — boutons et exécution. La liste des machines, leur compte et les chemins des clés vivent dans `serveurs.local.toml`, ignoré par git.

8. **Tout est journalisé, compté** : demande, confirmation, refus (et lequel), exécution, résultat, retour constaté — des événements déclarés (`serveur.action`), sans aucune sortie de serveur ni adresse.

## Paliers

- **J6f0** — cet ADR, pour relecture.
- **J6f1** — **une seule action : relancer les services**, en deux temps : **J6f1a** le côté serveur (`deploy/serveurs/` : script, installation, guide, essai à la main) et le programme `operateur` (table `serveur_actions`, interrupteur `[serveurs] actif = false`) ; **J6f1b** le bouton et sa confirmation (🔁 sous un constat `serveur_services` quand l'interrupteur est allumé, sous tout constat de ce type : seul l'opérateur lit `serveurs.local.toml` et refuse une machine non déclarée ; ✅ Confirmer, jeton à lui, 2 minutes ; `/constats <n°>` montre un constat seul avec ses boutons, quel que soit son rang). Essai réel prévu sur un VPS qui n'est ni la sentinelle ni l'hôte de Legion ; dans les faits (2026-10-11), la machine installée est la sentinelle (`v10`), le seul autre VPS n'étant pas sous Tailscale : elle accepte donc cette seule commande fixe, `cenacle-sentinel.service` exclu de toute relance — exception assumée, réversible en désinstallant.
- **J6f2** — le redémarrage : `cenacle-redemarrer` programme `shutdown -r +1` (annulable à la main pendant la minute) et refuse sans `/var/run/reboot-required`, à moins de 24 heures de fonctionnement, ou sur un nœud de grappe sans quorum, dont un nœud manque déjà, ou dont l'absence laisserait moins d'une majorité stricte des votes attendus (ajouté le 2026-10-13 : « tous les votes présents » ne suffit pas sur deux nœuds — 2 votes sur 2, l'un redémarre, l'autre perd le quorum ; les votes de ce nœud se lisent sur sa ligne `(local)`, illisibles = refus), ou **s'il y tourne encore des invités** (machines virtuelles, conteneurs — ajouté le 2026-10-12 : un redémarrage les arrêterait ; le nœud se vide à la main d'abord) ; sa propre clé ; côté Mac, 🔄 sous `serveur_redemarrage`, pas deux redémarrages d'une machine en 24 heures (table de l'opérateur, en plus du script) ; preuve : un relevé de Legion d'au moins 3 minutes après, la machine non `MALADE` et sans redémarrage demandé ; **pas revue 30 minutes après : alerte critique, une fois, de jour comme de nuit** (un relevé absent ne prouve rien).
- **J6f3** — les mises à jour de sécurité, sans redémarrage : `cenacle-maj-securite` lance `unattended-upgrade` (origine « sécurité » seule) en tâche de fond, dans l'unité `cenacle-maj` — une mise à jour dure plus qu'un appel —, et refuse si `unattended-upgrade` est réglé pour redémarrer tout seul, si une mise à jour tourne déjà, ou sous 1 Go libre ; sa propre clé ; ⬆ sous `serveur_maj_securite` ; preuve par Legion au moins 10 minutes après (plus de mises à jour en attente), avertissement une fois si elles le sont encore 2 heures après. Une mise à jour du noyau ou d'une bibliothèque fait apparaître ensuite, d'elle-même, les constats 🔄 ou 🔁 : chaque geste reste séparé et confirmé.

- **Révision du 2026-10-14 — dire pourquoi `serveurs.local.toml` est refusé.** Du 12 au 14 octobre, une liste `ports` collée par erreur dans le fichier, puis un bloc sans `cles`, ont fait refuser toutes les actions sous un seul message, « absent ou illisible ». Désormais chaque erreur de lecture porte une sorte, dans une liste fermée (`toml`, `racine`, `trop`, `bloc`, `cle_inconnue`, `nom`, `adresse`, `compte`, `cles`, `action`, `partagee`, `chemin`, et `absent`) ; l'opérateur l'enregistre comme refus (`config_<sorte>`, sans changement de schéma) et le message Telegram dit quoi corriger, renvoie à `npm run serveurs:verifier` — jamais une adresse, un chemin ou une valeur. Cette commande est un second point d'entrée de l'opérateur, seul à lire ce fichier (règle inchangée) : elle donne le détail, numéro du bloc compris, sur le Mac. Les refus déjà enregistrés gardent leur ancienne formulation.

## Conséquences

- **Le Mac doit être allumé** pour qu'un bouton agisse : sur le terrain, Mac fermé, rien ne se passe — le bot le dit (demande enregistrée, non exécutée dans les 2 minutes). La limite tombe quand Cénacle aura son serveur : `operateur` y déménage, les garde-fous ne changent pas.
- **Une surface d'attaque nouvelle** : des clés sur le Mac. Bornée par le serveur : au pire, quelqu'un qui tient le Mac redémarre une machine qui le demandait déjà, une fois par jour, sans perdre le quorum.
- **Le rythme dépend de Legion** : revérification et preuve du retour reposent sur sa ronde (15 minutes) ; compter jusqu'à 30 minutes pour savoir qu'une machine est revenue. Redémarrer l'hôte de Legion arrête un temps sa ronde : le pont le signalera (« la ronde de Legion ne répond plus »).
- Le jour où Cénacle reprendra la ronde (ADR-0025), il revérifiera par son propre bulletin.
- Aucune donnée personnelle : des noms de machines, des états, des codes de sortie.

## Options écartées

- **Une seule clé, un shell restreint** : une clé qui sait tout faire est une porte ; une clé par action borne ce qu'un vol permet.
- **Root ou `sudo` large** : contraire au moindre privilège ; le script, seul autorisé, porte ses propres refus.
- **Des garde-fous seulement sur le Mac** : ils tombent avec lui.
- **Un appui unique** : un appui égaré ou un compte détourné suffirait ; la confirmation de 2 minutes coûte un geste.
- **L'exécution par la ronde de sécurité** (toutes les 15 minutes) : trop lent pour un geste fait du terrain, et l'agent sécurité n'a pas à détenir de clé.
- **Une action proposée ou composée par le modèle** : interdit par la charte (règle 1).
- **L'arrêt d'une machine** : hors catalogue — on ne le rallume pas depuis Telegram.
