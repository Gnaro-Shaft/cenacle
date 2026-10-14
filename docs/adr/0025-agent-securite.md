# ADR-0025 — L'agent sécurité : des contrôles sans IA, des constats suivis, le CTO qui pilote

**Statut** : acceptée (2026-10-10) — jalon J6a de la phase 6 ; s'inspire de Legion (propositions, ronde, catalogue)

## Contexte

Rien ne surveillait au quotidien le Mac, les dépendances entre deux PR, ni le serveur : `npm audit` ne tournait qu'à la CI, gitleaks qu'au commit. Le jalon J6 (`docs/phase-6.md`) veut « une faille ou une mise à jour signalée **et suivie** », par un agent que le CTO supervise.

Le dirigeant a fixé la direction (2026-10-10) : l'agent remonte toute incohérence et propose une solution ; le CTO la lui relaie ; il accepte depuis Telegram ; à terme, le CTO règle seul les cas simples, dans des règles précises qui l'encadrent. **Les commandes ne sont jamais écrites par un agent** : elles sont prêtes d'avance, dans un catalogue fermé, et ne se débloquent qu'avec son accord.

## Décision

1. **Des contrôles déterministes, sans IA, en lecture seule, sans `sudo`** : FileVault, pare-feu, SIP, Gatekeeper, mises à jour de logiciels (`softwareupdate -l` ; une nouvelle version majeure de macOS n'est qu'une information), Tailscale (`version --upstream`), `npm audit` et `npm outdated` (une version majeure de retard) de Cénacle. Programmes fixes, chemins absolus, sans shell, environnement réduit, délai et sortie bornés. **Un contrôle qui ne répond pas comme attendu « n'a pas pu tourner »** : il ne prouve rien, ne ferme aucun constat, et devient lui-même un constat.
2. **Des constats suivis** (`securite_constats`), un seul actif par `(type, cible, occurrence)`, garanti par la base :
   - vu une fois : **candidat**, rien n'est dit (un raté passager ne réveille personne) ; revu **au moins 10 minutes après** sa première observation : **ouvert**, dit une fois (revu plus tôt, il reste candidat — voir la révision du 2026-10-11) ;
   - plus vu par un contrôle qui a tourné : **résolu**, dit une fois ; un candidat disparu : **caduc**, en silence ;
   - **accepté** par moi, avec une raison : il se tait pour cette occurrence ; une nouvelle occurrence (nouvel avis, nouvelle version) est un nouveau constat ; un risque accepté est redemandé après 90 jours ;
   - « dit » seulement **une fois le message parti** : un envoi raté repart au passage suivant.
3. **Un catalogue fermé de corrections**, écrit dans le code : pour chaque type, un conseil, et quand c'est sûr une commande **construite seulement de valeurs vérifiées** par les analyseurs. Ni la sortie d'un outil, ni le modèle n'écrivent une commande ; un type inconnu est refusé. Un avis npm dont le texte donne un ordre n'est pas affiché.
4. **Le CTO pilote et explique** : pour chaque nouveau constat, deux ou trois phrases du modèle local (le constat entre marqueurs, comme une donnée) ; tout ce qui ressemble à une commande, du code ou un lien est retiré ; marqué « généré par IA ». **Aucune IA dans les décisions** : l'ouverture, la fermeture et la sévérité viennent des données.
5. **Une ronde, puis les messages** (révisé le 2026-10-10, sur le modèle de la ronde de Legion : un passage par jour retardait un constat de 24 à 48 heures, l'anti-rebond exigeant deux passages) : une **ronde toutes les 15 minutes** (launchd, `StartInterval`) fait les contrôles locaux (FileVault, pare-feu, SIP, Gatekeeper) ; les contrôles réseau (mises à jour, Tailscale, npm) au plus **une fois par heure** ; un contrôle qui ne tourne pas lors d'une ronde ne ferme rien. Un nouveau constat **critique parle tout de suite**, à toute heure ; un **élevé** tout de suite **une fois le rapport du matin du jour parti** — ce que la nuit a trouvé part avec le rapport, en un seul message (révisé le 2026-10-11 : à 7 h 15, neuf élevés étaient partis seuls, un quart d'heure avant un rapport presque vide) ; le reste attend le **rapport du matin**, envoyé par la première ronde après 7 h 30, une fois par jour ; le lundi, le bilan l'accompagne. `/etat` dit quand a eu lieu la dernière ronde, et le signale au-delà de trois rondes manquées (surveiller le surveillant). `npm run securite -- constats` et `-- accepter <n°> <raison>`. Programme à part, qui ne détient que le jeton Telegram ; une ronde à la fois (verrou d'instance).
6. **L'agent ne corrige jamais rien lui-même** (charte, règle 1). Le journal ne reçoit que des nombres.

## Le pont avec Legion — les serveurs (2026-10-10)

Les serveurs (les deux VPS, les nœuds de la grappe maison, la machine qui héberge Legion) sont déjà surveillés par la **ronde de Legion** (son ADR-029), 24 h sur 24, depuis une machine allumée en permanence, toutes les 15 minutes, par un bulletin en lecture seule et une clé restreinte à lui. La refaire depuis le Mac ferait double emploi, et Legion a justement écarté le Mac (« une ronde qui s'arrête quand on ferme le portable n'est pas une ronde »).

- **Le pont** : le relevé de Legion sur le Mac laisse une copie brute de son verdict (`~/Library/Caches/fr.gnaro.legion.ronde.verdict`, 0600 — PR dans le dépôt Legion). L'agent sécurité la lit à chaque ronde (contrôle `legion_ronde`) : **Cénacle ne se connecte à aucun serveur et ne détient aucun nouveau secret**.
- **Strict** : un verdict tronqué, non daté, daté du futur, de plus de 45 minutes (trois relevés manqués) ou dont le compte de machines ne tombe pas juste « n'a pas pu tourner » — il ne ferme aucun constat de serveur, et devient le constat « la ronde de Legion ne répond plus » (élevé).
- **Chaque motif, un constat** : grappe sans quorum (critique), disque (élevé dès 90 %, par point de montage), mises à jour de sécurité (élevé), port inattendu (élevé, **un constat par port**), port attendu absent, redémarrage requis, services sur une bibliothèque remplacée (moyens), tout autre motif (moyen, sous ses mots sans leurs nombres). Un nombre qui change ne rouvre pas le constat ; un port nouveau en ouvre un.
- Le catalogue dit **sur quelle machine** lancer sa commande ; un redémarrage n'est jamais proposé comme commande.
- **Le jour où Cénacle remplacera Legion** (sur une machine permanente), il reprendra la ronde elle-même, avec sa propre clé restreinte et les mêmes bulletins, déjà posés.

## J6b — décider depuis Telegram (2026-10-10)

Sous chaque nouveau constat, et sous `/constats`, trois boutons : **✅ je m'en occupe** (« pris en charge », suivi jusqu'à ce qu'un contrôle le voie corrigé ; le bilan du lundi le rappelle au-delà de 7 jours), **☑ garder le risque** (le bot demande la raison, prise seulement en réponse directe à sa question, dans les 10 minutes), **❌ refuser** (se tait pour cette occurrence, redemandé 30 jours après la décision).

- Seuls mon compte et ma conversation privée sont entendus ; tout autre appui est ignoré, journalisé sans dire qui.
- Chaque constat offert porte un **jeton aléatoire à usage unique** : la décision ne s'applique qu'avec lui, et seulement à un constat encore à traiter, vérifié et écrit en une seule instruction — un bouton forgé, rejoué, d'un vieux message, ou un double appui ne change rien.
- La décision est écrite **avant** toute réponse ; si Telegram ne peut pas modifier le message, rien n'est perdu.
- Une panne de la base pendant un appui ne fait pas tomber le bot (comme en #75) : rien n'est décidé, et c'est dit.
- Aucune IA dans une décision ; le journal reçoit la sorte de décision, rien d'autre ; l'identifiant de ma conversation n'est pas gardé.

## J6c — les corrections débloquées par mon accord (2026-10-11)

Un quatrième bouton, **🔧 prépare la PR**, seulement sous un constat que le catalogue sait corriger **sans privilège** : une faille d'une dépendance dont une version corrigée est publiée (nom et version vérifiés). Le Mac et les serveurs restent à moi : jamais de `sudo` pour un agent.

- Mon appui ne fait qu'**enregistrer la demande** (le bot ne touche ni au code ni à GitHub) ; la **ronde suivante** l'exécute, après avoir revérifié que la correction s'applique toujours.
- **Le « conteneur »** : une copie de travail à part (`git worktree`, depuis `origin/main`, dans un dossier temporaire) — jamais le dépôt dont tournent mes services ; seul le fichier de verrouillage y est mis à jour (`npm install <paquet>@<version> --package-lock-only --ignore-scripts`) : **aucun code du paquet ne tourne sur le Mac** ; le changement ne doit toucher que des fichiers de paquets ; une branche `securite/correctif-…`, une PR ; **la CI de GitHub teste**, sur une machine jetable.
- **Accès GitHub** : l'accès `gh` déjà installé sur le Mac (décidé le 2026-10-11), limité par règle et par test : **jamais de fusion, jamais de poussée sur `main`, jamais de poussée forcée** — un test parcourt le code de l'agent et refuse ces mots.
- Je reçois le lien de la PR ; la fusion reste à moi ; la ronde voit ensuite la faille disparaître et résout le constat. Une CI qui échoue, une PR fermée sans fusion me sont dites une fois. Tout échec laisse ma copie de travail propre ; une branche qui n'a pas été poussée est supprimée.
- Le journal reçoit l'issue de chaque action (`securite.action`) : les faits dont le carnet de confiance de J6d aura besoin.

## Paliers à venir
- **J6d** — fait : voir l'ADR-0026 (✅ Fusionner par mon bouton, carnet de confiance, délégations dans `securite.toml`).
- **J6e1** — fait : la sentinelle surveille aussi l'agent (un battement par ronde allée à son terme, 35 minutes de silence ; révision de l'ADR-0002).
- **J6f** — les actions sur les serveurs : voir l'ADR-0027, qui révise « Cénacle ne se connecte à aucun serveur ».
- **J6e** — suite : le serveur (bulletin en lecture seule, puis des scripts fixes posés sur le serveur, joignables par une clé restreinte à eux, déclenchés par mon accord ; un redémarrage reste toujours une question), mes autres projets, les bulletins de sécurité.

## Révision du 2026-10-11 — dix minutes entre les deux observations

Le principe (deux observations avant de parler) ne change pas ; on précise l'écart minimal entre elles, comme Legion. Une ronde lancée à la main juste après la ronde planifiée avait ouvert un port éphémère du serveur, vu deux fois dans la même minute puis disparu, et l'avait dit comme urgent. Désormais un candidat revu moins de 10 minutes après sa première observation reste candidat ; une première observation datée dans le futur (horloge reculée) n'ouvre jamais. Avec une ronde toutes les 15 minutes, rien ne change en régime normal, critiques compris.

## Révision du 2026-10-11 — mes autres projets (J6e2)

L'agent surveille aussi les projets que je déclare dans `securite.local.toml` (ignoré par git : il contient des chemins de ma machine ; un exemple versionné, `securite.local.example.toml`). Pour chacun, en lecture seule, avec les contrôles réseau (une fois par heure) :

- **les failles de ses dépendances** : `npm audit --package-lock-only`, sur le fichier de verrouillage seul — rien n'est installé ni changé dans le projet ; la liste des dépendances part au registre npm, comme pour Cénacle ;
- **les secrets commités** : `gitleaks git --redact` sur l'historique git, sur le Mac. Seuls la règle, le fichier, la ligne et le commit sont lus ; la valeur, l'auteur, son adresse et le message du commit ne le sont jamais. Hors d'un dépôt git, gitleaks répond « rien trouvé » : le contrôle est alors tenu pour « n'a pas pu tourner ».

Chaque projet a ses propres contrôles (`npm_<nom>`, `fuites_<nom>`) : un projet en panne ne ferme rien ailleurs, et le constat nomme le projet, jamais son chemin. Une liste illisible est elle-même un constat, jamais une ronde en échec. **Pas de 🔧** : la préparation de PR ne connaît que le dépôt de Cénacle ; le catalogue donne la commande à lancer dans le projet. Les failles de dépendances des autres projets **attendent le rapport du matin**, quelle que soit leur gravité ; **un secret commité parle tout de suite** (élevé, en journée), parce qu'il faut le changer. Au plus 20 secrets par projet, puis un constat « et d'autres » ; le CTO commente au plus les **5 constats les plus graves** d'un message.

Hors périmètre : les dépendances Python (J6e2b, avec `pip-audit` installé par moi), le retard de versions majeures des autres projets.

## Révision du 2026-10-11 — les bulletins du CERT-FR (J6e3)

L'agent lit, avec les contrôles réseau (une fois par heure), les deux flux publics du CERT-FR — ses **alertes** (failles activement exploitées) et ses **avis** — par le lecteur de flux de la veille (délai, taille plafonnée). Un bulletin n'est retenu que si son titre nomme, en mot entier, un logiciel de la table `[bulletins]` : celle de `securite.toml` (versionnée : ce que le code dit déjà publiquement) et mes ajouts privés dans `securite.local.toml`. Le titre est nettoyé et plafonné, tu ne vois pas celui qui ressemble à un ordre ; le lien n'est gardé que sous la forme exacte du CERT-FR.

- **Une alerte** (moins d'un an, non marquée « [Clos] ») : élevée, dite tout de suite en journée ; résolue quand le CERT-FR la clôt.
- **Un avis** (moins de 7 jours) : moyen, au rapport du matin ; sorti du flux, il **expire en silence** (caduc) — rien n'a été corrigé, il n'est plus d'actualité.
- **✅ sur un bulletin veut dire « traité »** : aucun contrôle ne peut voir qu'un bulletin a été appliqué ; il se tait comme un risque gardé (raison « Traité (✅) »), redemandé après 90 jours s'il est encore publié. ☑ dit « pas concerné », avec la raison.
- Un flux injoignable, vide ou changé en page web, ou une liste illisible : le contrôle « n'a pas pu tourner », ne ferme rien, et le dit.

Le mot du CTO (modèle local) dit si le bulletin me concerne ; le texte du bulletin lui est donné comme une donnée, il ne donne jamais de commande. Hors périmètre : comparer les versions installées aux versions vulnérables, d'autres sources, toute action déclenchée par un bulletin.

## Révision du 2026-10-14 — l'opérateur bloqué ou silencieux

Deux types de constats nouveaux, de sévérité élevée, nés d'un vide observé : du 12 au 14 octobre, `serveurs.local.toml` faisait refuser toutes les actions sur les serveurs, et rien ne le disait tant qu'on ne demandait rien. L'opérateur (ADR-0027) laisse à chaque passage un petit fichier d'état sur le Mac (`instant`, `config=ok` ou la sorte d'erreur, `fin=1` — jamais une adresse, un chemin, un nom de machine) ; l'agent de sécurité le lit à chaque ronde, avec l'interrupteur `[serveurs] actif` de `securite.toml` — jamais `serveurs.local.toml`, qui reste à l'opérateur seul.

- **`operateur_config`** : l'interrupteur est actif et l'opérateur refuse sa liste ; l'occurrence est la sorte d'erreur. Correctif : `npm run serveurs:verifier`, à lancer soi-même.
- **`operateur_silencieux`** : l'interrupteur est actif et l'état est absent, illisible, daté du futur ou vieux de plus de 10 minutes (dix passages manqués). Correctif : vérifier le service (`launchctl list | grep org.cenacle.operateur`).
- Interrupteur coupé : aucun constat. Le cycle de vie est l'ordinaire : 10 minutes avant de compter, un message tout de suite le jour et au rapport la nuit (élevé, pas critique : rien n'est cassé, on ne peut seulement plus agir), résolu dès que l'état redit `ok`.

## Conséquences

- `npm audit` envoie la liste des dépendances au registre npm, `tailscale version --upstream` et `softwareupdate` interrogent leurs éditeurs : aucune donnée personnelle (registre, services tiers).
- Les constats ne contiennent aucune donnée de personne (paquets, réglages du Mac) ; ils ont malgré tout leurs durées : 365 jours après la clôture, 90 jours pour un risque accepté.

## Options écartées

- **Un agent qui corrige seul** : contraire à la charte, et un agent avec `sudo` est une porte.
- **Des commandes proposées par le modèle** : un avis ou un flux piégé pourrait lui en souffler une.
- **Une alerte à chaque passage** : du bruit ; seul ce qui change est dit, le reste attend le bilan du lundi.
