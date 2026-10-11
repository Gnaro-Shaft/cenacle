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
     - `cenacle-redemarrer` : refuse si aucun redémarrage n'est demandé (`/var/run/reboot-required` absent), si la machine a redémarré depuis moins de 24 heures, et, sur la grappe, si un autre nœud manque (le quorum serait perdu) ;
     - `cenacle-services` : ne relance que ce que `needrestart` désigne, jamais le démon SSH ni le service qui porte la grappe ;
     - `cenacle-maj-securite` : n'installe que l'origine « security », ne redémarre jamais.
   - Chaque exécution laisse une trace dans le journal système du serveur (`logger -t cenacle`), refus compris.

3. **Sur le Mac, mon bouton, confirmé.**
   - Sous un constat serveur venu du pont, et seulement pour l'action qui y répond (un redémarrage demandé → 🔄 Redémarrer ; des services à relancer → 🔁 Relancer les services), un bouton à jeton unique.
   - Mon appui ne déclenche rien : le bot me demande **« Confirmer … sur noeud-a ? »**, avec un second bouton à usage unique, **valable 60 secondes**. Un appui égaré, ou un message vieux, ne suffit pas.
   - La demande confirmée est seulement **enregistrée** ; le bot ne détient aucune clé.

4. **Un programme à part, `operateur`, seul détenteur des clés.** Lancé par launchd chaque minute, verrou d'instance (ADR-0023). Il ne détient que la famille de secrets `serveurs` (les chemins des clés, un `known_hosts` à lui, `StrictHostKeyChecking=yes`), plus de quoi me répondre sur Telegram. Ni le CTO, ni le bot, ni l'agent sécurité ne lisent les clés.
   - **Avant d'agir, il revérifie** (charte, règle 5) : le dernier relevé de Legion a moins de 20 minutes et montre **encore** le problème ; sinon rien n'est fait, et il me dit pourquoi.
   - **Une seule action à la fois**, toutes machines confondues ; au plus un redémarrage par machine et par 24 heures (le script le refuse aussi).
   - Le code de sortie du script et la règle qui a refusé, s'il y en a une, me sont dits ; jamais une sortie brute du serveur.

5. **Après coup, la preuve.** Les relevés suivants de Legion doivent montrer la machine revenue et le problème disparu : le résultat m'est dit. Une machine **qui ne revient pas en 30 minutes** est une alerte critique, de jour comme de nuit.

6. **Jamais délégable, jamais déclenché par un agent.** Comme la fusion (ADR-0026), aucune de ces actions n'entre dans les délégations ; un agent ne peut que montrer le bouton. **Aucun modèle** n'intervient : ni pour proposer l'action (le catalogue répond au type de constat), ni pour la décider, ni pour juger du résultat.

7. **Un interrupteur général** : `[serveurs] actif = false` dans `securite.toml` (versionné) coupe tout — boutons et exécution. La liste des machines, leur compte et les chemins des clés vivent dans `serveurs.local.toml`, ignoré par git.

8. **Tout est journalisé, compté** : demande, confirmation, refus (et lequel), exécution, résultat, retour constaté — des événements déclarés (`serveur.action`), sans aucune sortie de serveur ni adresse.

## Paliers

- **J6f0** — cet ADR, pour relecture.
- **J6f1** — **une seule action : relancer les services**, en deux temps : **J6f1a** le côté serveur (`deploy/serveurs/` : script, installation, guide, essai à la main) et le programme `operateur` (table `serveur_actions`, interrupteur `[serveurs] actif = false`) ; **J6f1b** le bouton et sa confirmation. Essai réel sur un VPS qui n'est ni la sentinelle ni l'hôte de Legion.
- **J6f2** — le redémarrage : quorum de la grappe, 24 heures, preuve du retour, alerte si la machine ne revient pas.
- **J6f3** — les mises à jour de sécurité, sans redémarrage.

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
- **Un appui unique** : un appui égaré ou un compte détourné suffirait ; la confirmation de 60 secondes coûte un geste.
- **L'exécution par la ronde de sécurité** (toutes les 15 minutes) : trop lent pour un geste fait du terrain, et l'agent sécurité n'a pas à détenir de clé.
- **Une action proposée ou composée par le modèle** : interdit par la charte (règle 1).
- **L'arrêt d'une machine** : hors catalogue — on ne le rallume pas depuis Telegram.
