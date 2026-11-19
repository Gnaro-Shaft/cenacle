# ADR-0044 — La copie de la base : ce qui ne se relit pas, chiffré, hors du Mac

**Statut** : acceptée (2026-11-17) — révise la décision du 04/10 (« la base n'est pas sauvegardée », `docs/securite/secrets.md`) ; s'appuie sur l'ADR-0043 (la veille des sauvegardes) et l'ADR-0038 (les rôles de la base)

## Contexte

Le 04/10, j'ai décidé de **ne pas sauvegarder la base** : la mémoire des mails se relit depuis la boîte, les propositions sont purgées à 90 jours, le journal ne contient aucune donnée de personne ; ne rien copier évitait de faire suivre les purges et les effacements dans des copies. Seule la **liste d'opposition** fait exception : elle part, chiffrée, dans l'archive des secrets (`npm run secrets:backup`), à la main.

Depuis, des tables sont arrivées qui **ne se relisent de nulle part** :

| Table | Ce que sa perte coûte |
|---|---|
| `rappels` (T-10, ADR-0041) | Mes rappels à venir, perdus sans le savoir : ils ne sonneraient pas. |
| `prospection_cartes` (T-09, ADR-0032) | Mes démarches : colonnes, raisons, candidatures confirmées. Les alertes se relisent depuis la boîte, mes décisions non. |
| `veille_articles` (ADR-0024) | L'archive de ce que la veille m'a envoyé : sans elle, elle me renverrait des articles déjà lus. |
| `securite_constats` (ADR-0025) | Mes décisions sur les constats : un risque gardé et sa raison, un constat pris en charge. Sans elle, tout se rouvre et se redécide. |

**`prospection_mails_lus` n'en est pas** : chacune de ses lignes désigne un mail de la mémoire d'Iris par son identifiant, et disparaît avec lui (un déclencheur, `027_prospection.sql`) — y compris à l'effacement d'une personne. Restaurée sans la mémoire des mails, elle désignerait des identifiants que la mémoire reconstruite réattribuera : de nouvelles alertes seraient tenues pour lues, en silence, et ses lignes ne seraient plus jamais purgées. Sans elle, l'agent relit ses alertes ; les doublons de cartes sont déjà empêchés par leur clé (`duplicate_key`, `on conflict do nothing`).

La base tourne sur le Mac, dans Docker (`compose.yaml`) : un disque perdu, un volume effacé, et ces tables partent avec. **La décision du 04/10 ne tient plus pour elles.** Elle tient toujours pour le reste.

Ce que Legion faisait pour ses propres bases (son ADR-027) : une copie datée chaque jour, tirée par le serveur de sauvegarde avec une clé **en lecture seule** sur un seul dossier, vérifiée, 7 jeux gardés, un verdict au format commun. La base de Myriade, elle, est tirée chaque nuit et **chiffrée avec `age`** avant d'être posée sur le serveur de sauvegarde. Cénacle reprend les deux idées.

## Décision

1. **Copier les quatre tables, et elles seules.** Chaque nuit, un programme du Mac, `copie-base`, en exporte **les données** (`pg_dump --data-only --format=custom` sur ces quatre tables ; le schéma vient des migrations). Rien d'autre de la base : ni le journal, ni la mémoire des mails, ni les propositions, ni la liste d'opposition (elle reste dans l'archive des secrets, avec la clé sans laquelle elle ne sert à rien).
   - **Par un rôle à lui, `cenacle_copie`**, qui n'a que `SELECT` sur ces quatre tables **et sur les séquences qu'elles possèdent** (chacune a une colonne d'identité, `GENERATED ALWAYS` : leurs valeurs partent avec, sinon une ligne nouvelle après restauration heurterait une restaurée). Une migration le crée, comme les autres rôles (ADR-0038).
   - **Jamais par une connexion locale du conteneur** : l'image de Postgres y fait confiance à tout le monde, et `docker exec` y serait super-utilisateur. `pg_dump` se connecte par **l'adresse du conteneur sur son réseau** (lue avec `docker inspect`, jamais une adresse `127.*`), en `-U cenacle_copie`, son mot de passe passé par nom (`docker exec -e PGPASSWORD`), jamais en argument visible dans la liste des processus. Une épreuve sur le code le vérifie, et un essai réel : un mauvais mot de passe n'exporte rien.
   - *Corrigé le 17/11, en B1b* : ce point disait `-h 127.0.0.1`. C'était faux : le `pg_hba.conf` de l'image fait aussi confiance (`trust`) à `127.0.0.1` et `::1`, pas seulement à la prise locale ; le mot de passe n'y était jamais vérifié. Seule une autre adresse tombe sous la règle `scram-sha-256`.
   - Il est lancé par launchd (à 02:30 ; un Mac endormi la fait au réveil), avec un verrou d'instance.

2. **Chiffrée pour une clé que le Mac n'a pas.** La copie est chiffrée **avant de quitter le processus** avec `age`, pour une **clé publique** — pas un secret : elle va dans `copie.local.toml` (non versionné), avec l'hôte de destination. La clé privée qui la déchiffre **n'est pas sur le Mac** : je la garde ailleurs (mon gestionnaire de mots de passe, et une copie hors ligne). Le Mac peut faire une copie, jamais la relire : un Mac compromis ne donne pas les copies passées, et le serveur qui les garde ne peut pas les lire. `age` est l'outil que Myriade utilise déjà ; c'est le binaire officiel (`brew install age`), pas un chiffrement maison. **Tranché le 17/11 : le binaire `age`**, plutôt que le paquet npm `age-encryption` du même auteur — le même outil que Myriade, et aucune dépendance de plus dans Cénacle.

3. **Les secrets, et qui les détient.**
   - Le mot de passe de `cenacle_copie` va dans **`.env.copie`**, une famille nouvelle, détenue par `copie-base` **et par les migrations** qui créent le rôle — comme les autres rôles (`docs/securite/secrets.md`). Tout autre programme refuse de démarrer s'il la trouve.
   - La **clé de poussée** est un fichier (`~/.ssh/cenacle/copie-pousser`, droits 600), que la règle des familles ne voit pas : un test vérifie que seul `copie-base` le nomme. Perdue ou volée : je retire sa ligne de `authorized_keys`, j'en tire une nouvelle (la marche à suivre est dans `deploy/serveurs/README.md`).

4. **Posée sur le serveur de sauvegarde, par une porte qui n'écrit que là.** Le Mac pousse la copie sur le nœud qui garde déjà les autres sauvegardes, par sa clé, verrouillée côté serveur : `restrict,command="rrsync -wo -no-del -no-overwrite <arrivée>"`. Elle **écrit** dans un seul dossier, l'**arrivée**, ne lit rien, n'efface rien, n'écrase rien, ne lance rien d'autre. Le nom de chaque copie porte la date et un suffixe tiré au hasard. C'est un **chemin nouveau** — jusqu'ici Cénacle ne faisait que lire les serveurs (le bulletin) ou y lancer des actions du catalogue (l'opérateur). `rrsync` et ses options n'existent qu'à partir de rsync 3.2.4, avec python3 : à vérifier par moi sur le nœud avant B1 (`rrsync -h`).

5. **Le serveur reçoit, garde et juge — à son heure, pas à celle du Mac.** Sur le serveur de sauvegarde, un minuteur `veiller-copie-cenacle` (posé par `deploy/serveurs/`, en root comme les autres veilles), **toutes les heures** :
   - **déplace** chaque arrivée dans un dossier que seul root lit, en notant **l'heure de son arrivée** (l'horloge du serveur : celle du fichier, que le client de rsync peut fixer, n'est jamais crue) ;
   - refuse et signale une copie **sans en-tête `age`**, **vide**, ou une **deuxième copie dans la même nuit** (*révisé le 19/11 : gardée et signalée, voir plus bas* ; une clé volée ne peut pas noyer les vraies sous des fausses sans que le verdict le dise) ;
   - **efface les copies arrivées depuis plus de 7 jours, sauf la plus récente** : si le Mac n'en fait plus, la dernière reste — c'est la seule entorse aux 7 jours, et le verdict la signale dès 36 heures ;
   - écrit **un verdict au format commun** (`verdict=`, `instant=`, `depuis=`, `gardes=`, `refusees=`, `motif=`, `fin=1`) sous `/var/lib/copie-cenacle/verdict`, lisible par le compte `cenacle` : MALADE si la plus récente est arrivée il y a plus de **36 heures**, ou si une copie a été refusée depuis le dernier verdict sain.

   - *Précisé le 18/11, en B1c, avec ton accord* :
     - **« la même nuit »**, c'est moins de 12 heures après la copie gardée la plus récente, à l'heure d'arrivée ; un transfert inachevé depuis 6 heures est refusé aussi ;
     - **« refusée depuis le dernier verdict sain »**, prise à la lettre, ne redevenait jamais saine : le verdict est MALADE **tant qu'un refus est au moins aussi récent que la copie gardée la plus récente** ; la copie saine suivante le lève. Un Mac réveillé le soir après une nuit manquée pousse deux copies à quelques heures d'écart : la fausse alerte s'efface d'elle-même la nuit suivante. Les refusées restent 7 jours en quarantaine, à root seul, sous un nom qui dit leur heure et leur raison, jamais le nom reçu ;
     - le verdict ajoute **`derniere=`**, l'heure d'arrivée de la copie la plus récente : on peut le recalculer ;
     - l'arrivée est d'abord **sortie de la portée du compte de dépôt** (un renommage vers un dossier de root, sur le même disque), puis seulement examinée : le compte ne peut plus l'échanger contre un lien.

   - *Révisé le 19/11, en B1c, avec ton accord* : une **deuxième copie dans la même nuit est gardée et signalée**, et non plus refusée. Refusée, une fausse copie poussée avec une clé volée **avant** la vraie faisait refuser la vraie, nuit après nuit : au bout de 7 jours, il ne restait que des fausses. Gardées toutes les deux, aucune n'évince l'autre, chacune reste ses 7 jours ; le verdict est MALADE **tant que plus d'une copie gardée est arrivée à moins de 12 heures de la plus récente** ; la suivante, seule dans sa nuit, le lève. Le but de la règle tient : une clé volée ne noie pas les vraies sans que le verdict le dise. Reste le risque déjà dit plus bas : une fausse copie seule dans sa nuit, que seule une restauration révèle ; et la restauration (B1d) ne doit pas choisir seule entre deux copies d'une même nuit.

   Le bulletin ajoute cette source, **`copie-cenacle`**, à sa liste fermée et ses clés à leur liste (ADR-0043, point 1) ; la ronde la juge comme les autres dès S2. Une copie qui ne part plus se voit donc **sur Telegram en 36 heures**.

6. **Les copies suivent les purges et les effacements.**
   - Une donnée purgée ou effacée dans la base disparaît des copies **en 7 jours**, ou, si le Mac n'a fait aucune copie depuis, à la copie suivante — c'est ce que dit le registre.
   - Aucune des quatre tables n'est atteinte par l'effacement d'une personne (`npm run personne` : la mémoire des mails, ce qui en dépend, la liste d'opposition) : le texte des rappels exclut les tiers par règle, les cartes de prospection ne portent pas de nom de personne. Si cela change, cet ADR se révise.

7. **Une restauration qui tient compte des services.** `npm run base:restaurer -- --depuis <fichier>`, par le rôle propriétaire :
   - **arrête d'abord** les services qui écrivent dans ces tables (launchd les relance sinon d'eux-mêmes : le bot, l'agent sécurité, la veille, la prospection), applique les migrations ;
   - déchiffre avec ma clé privée (demandée, jamais gardée ni écrite) ;
   - refuse une table non vide, sauf avec **`--remplacer`**, qui la vide et la recharge **dans une seule transaction**, avec la valeur de ses séquences ;
   - **rejoue les purges** des quatre tables (elles existent : `rappels.ts`, `prospection-store.ts`, `veille-store.ts`, `securite-store.ts`), puis relance les services.

   Ce que la restauration ramène, à dire : un rappel annulé après la copie revient ; un rappel qui a sonné après la copie sonne de nouveau ; une décision prise après la copie est à reprendre.

   - *Précisé le 19/11, en B1d, avec ton accord* :
     - **les migrations ne sont pas appliquées** par la restauration : elles demandent trois familles de secrets (propriétaire, exécutant, copie). Elle vérifie que la base a **chaque colonne de la copie**, et sinon refuse en disant `npm run db:migrate`. Elle ne détient que **la famille du propriétaire**, qui gagne ce détenteur (avec les migrations et les tests) ;
     - **`--remplacer` est refusé tant que `securite_raisons` ou `serveur_actions` ont des lignes** : elles pointent vers `securite_constats` (`ON DELETE CASCADE`) sans être copiées, et la vider les effacerait en silence. Le refus dit combien ;
     - **la copie n'est pas crue** : une clé de poussée volée et la clé publique suffisent à en forger une, et les entrées d'une archive portent leur propre SQL. Le script que `pg_restore` en tire est jugé ligne à ligne : passent les blocs `COPY` des quatre tables, les `setval` de leurs séquences, les `SET` de `pg_dump` et sa garde `\restrict` — chacun une fois, tous les quatre. Rien d'autre ; sinon, rien n'est rechargé ;
     - **la clé privée se tape au terminal**, sans écho (les trois lignes d'`age-keygen` collées passent) ; elle va à `age` par son entrée, jamais en argument, dans l'environnement ou un fichier. Ni la copie déchiffrée ni le script ne touchent le disque ;
     - **les services arrêtés** sont ceux qui écrivent dans ces tables : le bot, le serveur de la page, l'agent sécurité, la veille, la prospection et l'opérateur (ses actions pointent vers les constats) — chacun chargé, et eux seuls, relancés quoi qu'il arrive ;
     - tout ce qui peut refuser refuse **avant** que rien ne s'arrête ; une erreur dans la transaction ne change aucune table, et le message ne cite jamais une ligne.

8. **Une restauration éprouvée, pas supposée.** Une copie qu'on n'a jamais restaurée n'est pas une copie : le premier palier se termine par **une restauration réelle** dans la base de test (`cenacle_test`), comparée table à table à la production — par des comptes de lignes, des sommes de contrôle et les valeurs des séquences, jamais en affichant une ligne.
   - *Précisé le 19/11, en B1d* : c'est `npm run base:restaurer -- --depuis <fichier> --essai` — la base de test rechargée (ses tables vidées d'abord), aucun service arrêté, chaque table dite « identique » ou « diffère de la production ». À lancer juste après une copie fraîche : ce qui a changé en production depuis la copie diffère, à juste titre.

9. **Aucune IA, aucun tiers nouveau.** Le serveur de sauvegarde est à moi (France) ; rien ne part chez un fournisseur. Rien à inscrire au registre de l'IA. Au registre des traitements : une ligne « copies de la base » (les quatre tables, chiffrées, leur durée, le serveur de sauvegarde), et la durée des copies pour T-09 et T-10.

10. **Tests adversariaux exigés** :
    - le rôle `cenacle_copie` ne lit aucune autre table ni séquence, et n'écrit nulle part ;
    - la copie ne contient que les quatre tables et leurs séquences (la liste lue dans l'archive elle-même), et rien en clair ne touche le disque du Mac ni le réseau (épreuve sur le code et sur un fichier produit) ; `pg_dump` ne passe jamais par une connexion locale du conteneur ni par un mot de passe en argument ;
    - sans destinataire valide, ou si `age` échoue, rien ne part, et le programme le dit ;
    - la clé de poussée ne lit, n'efface ni n'écrase (essai réel contre `rrsync -wo -no-del -no-overwrite` dans un conteneur) ;
    - le serveur : une copie vide, sans en-tête `age`, une deuxième dans la nuit, une date de fichier dans le futur ou le passé n'abusent pas le verdict ; l'âge se mesure à l'arrivée ; au-delà de 7 jours, tout s'efface sauf la plus récente ; plus de 36 h sans arrivée rend MALADE ;
    - la restauration arrête les services, refuse une table non vide sans `--remplacer`, recharge séquences comprises, rejoue les purges, ne garde pas la clé privée ;
    - un programme autre que `copie-base` et les migrations refuse de démarrer avec la famille `copie` ; seul `copie-base` nomme la clé de poussée.

## Paliers

- **P0** — cet ADR, pour relecture.
- **B1** — le rôle et sa migration, la famille `.env.copie`, `copie.local.toml`, le programme `copie-base` (export, chiffrement, poussée), le minuteur et le verdict du serveur ; la clé, l'arrivée et la vérification de `rrsync` faites par moi ; puis **la restauration réelle** dans `cenacle_test`.
- **B2** — la source `copie-cenacle` et ses clés dans le bulletin, sa déclaration dans `parc.local.toml` ; jugée par la ronde avec S2 (ADR-0043).
- **B3** — `secrets.md` (le titre « La base de Cénacle n'est pas sauvegardée » et la famille), le registre (la ligne des copies, la note du 04/10, les durées de T-09 et T-10), la marche à suivre pour restaurer.

## Conséquences

- **Mes rappels, mes démarches et mes décisions survivent au disque du Mac**, et je le sais : le verdict est surveillé.
- **Un chemin d'écriture vers un serveur**, le premier de Cénacle, borné à un dossier d'arrivée, sans lecture, effacement ni écrasement. Volée, la clé permet d'y déposer des fichiers : remplir le disque, ou glisser une fausse copie — qui serait refusée sans en-tête `age`, et dite si elle double une nuit. Une fausse copie chiffrée pour une autre clé, seule dans sa nuit, passerait pour vraie : seule une restauration la révèle. D'où une restauration d'essai, à refaire de temps en temps.
- **Une clé privée de plus à garder**, hors du Mac. Perdue, les copies sont illisibles : la perdre, c'est revenir au 04/10.
- **Un secret de plus**, `.env.copie`, à ajouter à l'archive des secrets.
- **Un programme de plus** sous launchd sur le Mac, une fois par nuit ; un minuteur de plus sur le serveur, toutes les heures.

## Options écartées

- **Copier toute la base** : plus simple à restaurer, mais la mémoire des mails, les propositions et le journal partiraient dans des copies, quand ils se relisent ou se purgent — c'est exactement ce que la décision du 04/10 voulait éviter.
- **Copier aussi `prospection_mails_lus`** : ses identifiants n'ont de sens qu'avec la mémoire des mails, qui n'est pas copiée (voir le contexte).
- **Le serveur tire la copie depuis le Mac** (comme Legion pour ses bases) : un accès entrant sur le Mac, qui n'en a aucun aujourd'hui, et un Mac souvent endormi la nuit.
- **Une phrase de passe, comme `secrets:backup`** : la tâche planifiée devrait la connaître, donc la garder sur le Mac ; un Mac compromis donnerait les copies passées.
- **Garder les 7 dernières copies, quel que soit leur âge** : un Mac éteint une semaine garderait des données purgées au-delà de 7 jours, et sept fausses copies chasseraient les vraies.
- **iCloud Drive ou un disque externe** : iCloud, hors UE possible et hors de ma veille ; un disque externe n'est pas toujours branché, et une copie qui ne part pas sans le dire est pire que pas de copie.
- **Restic, déjà sur le serveur de sauvegarde** : il sauvegarde le serveur, pas le Mac ; le faire tourner sur le Mac ajoute un outil et un dépôt à gérer pour quelques mégaoctets par nuit.
