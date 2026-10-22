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

## Révision du 2026-10-16 — le nouveau domaine du CERT-FR

Le CERT-FR a déménagé sur `cert.cyber.gouv.fr` ; l'ancien domaine redirige, et ses flux portent encore des liens vers l'ancien. L'agent lit désormais les flux sur le nouveau domaine, reconnaît les liens des deux domaines (toujours en `https`, jamais un sosie), et construit le lien du constat sur le nouveau. Surtout : un flux qui contient des bulletins dont **aucun** lien n'a la forme du CERT-FR rend le contrôle « n'a pas pu tourner », au lieu d'un silencieux « rien trouvé » — le prochain changement de format se verra le jour même. Les constats déjà enregistrés gardent leur lien de l'ancien domaine, toujours affiché.

## Révision du 2026-10-14 — l'opérateur bloqué ou silencieux

Deux types de constats nouveaux, de sévérité élevée, nés d'un vide observé : du 12 au 14 octobre, `serveurs.local.toml` faisait refuser toutes les actions sur les serveurs, et rien ne le disait tant qu'on ne demandait rien. L'opérateur (ADR-0027) laisse à chaque passage un petit fichier d'état sur le Mac (`instant`, `config=ok` ou la sorte d'erreur, `fin=1` — jamais une adresse, un chemin, un nom de machine) ; l'agent de sécurité le lit à chaque ronde, avec l'interrupteur `[serveurs] actif` de `securite.toml` — jamais `serveurs.local.toml`, qui reste à l'opérateur seul.

- **`operateur_config`** : l'interrupteur est actif et l'opérateur refuse sa liste ; l'occurrence est la sorte d'erreur. Correctif : `npm run serveurs:verifier`, à lancer soi-même.
- **`operateur_silencieux`** : l'interrupteur est actif et l'état est absent, illisible, daté du futur ou vieux de plus de 10 minutes (dix passages manqués). Correctif : vérifier le service (`launchctl list | grep org.cenacle.operateur`).
- Interrupteur coupé : aucun constat. Le cycle de vie est l'ordinaire : 10 minutes avant de compter, un message tout de suite le jour et au rapport la nuit (élevé, pas critique : rien n'est cassé, on ne peut seulement plus agir), résolu dès que l'état redit `ok`.

## Révision du 2026-10-20 — le nom du paquet gardé, la coupe à la phrase

L'évaluation des modèles du 20/10 a montré deux défauts du nettoyage du mot du CTO : tout ce qui était entre accents graves disparaissait, nom du paquet compris (« Le paquet , utilisé pour les requêtes HTTP »), et le texte était coupé en pleine phrase à 400 caractères (les deux modèles écrivent deux phrases d'environ 430 caractères ; coupé à la phrase sous 400, le risque se perdait une fois sur deux).

- **Un nom court entre accents graves est gardé, en texte simple** : un seul mot de 40 caractères au plus, en lettres et chiffres ASCII avec `. _ - +`, un `@` seulement devant un numéro de version, isolé entre des espaces ou de la ponctuation (collé au texte, il ferait un domaine ou un compte : evil.\`com\`, @\`bot\`). Jamais un chemin, un signe du shell, une option (`-rf`), un mot qui est une commande à lui seul ou en lance une (`sudo`, `rm`, `sh`, `reboot`…), ni ce que Telegram changerait en lien : un domaine (`evil.example`, `install.sh` ; seules des extensions de fichier connues passent, aucune n'étant un domaine de premier niveau au 20/10 : `dev.ts`, `.env`, `Node.js`), une adresse IP, un compte (`@types/node`, `x@latest`).
- **Un nom ne complète jamais une commande** : si le texte, noms remis, a la forme d'une commande (`sudo` suivi d'un mot, `npm install`, `npx` suivi d'un nom, un interpréteur suivi d'un script, une option `-x` ou `+x` quel que soit le programme, `curl -…`, `| sh`, `&&`…), jugée sans caractères invisibles, marques combinantes ni lettres larges, tous les noms sont retirés, comme avant.
- **Le mot du CTO s'arrête à sa dernière phrase complète, 600 caractères au plus** ; une première phrase plus longue est coupée au dernier mot, suivie de « … ». Un message trop long pour Telegram reporte déjà les constats suivants dans « + N autre(s) constat(s) ».

Reste ouvert, hors de cette révision : une commande ou un domaine écrits en pleine phrase, sans accents graves, passaient encore — voir la révision suivante.

## Révision du 2026-10-20 — commandes, liens et comptes en pleine phrase

Sans accents graves ni ligne à part, une commande (« lance sudo npm install -g left-pad-test@latest maintenant ») ou un domaine (« evil.example/fix ») passaient tels quels, et un « @compte » ou une « /commande » serait devenu un lien dans Telegram : sur 27 pièges écrits en pleine phrase, 25 passaient (vérifié par exécution).

- **Une phrase qui a la forme d'une commande est retirée entière** : la même forme que pour les noms (`sudo` suivi d'un mot, `npm install`, une option `-x`, `curl -…`, `| sh`…), jugée sans caractères invisibles ni lettres larges, sur la phrase telle quelle, puis une seconde fois sans ses liens (un lien glissé entre les mots d'une commande ne la cache pas). **Choix du dirigeant : la forme large**, même quand la commande n'est citée que pour expliquer (« lors d'un npm install », « les droits sudo sont trop larges ») : la phrase part, le constat et le conseil du catalogue restent.
- **Un lien, un compte, une commande pour un bot, un chemin ou une adresse IP est retiré, le mot seul** (la ponctuation qui le suit reste) : une adresse web ; `@` suivi d'une lettre, ou d'un chiffre en début de mot (`@evilbot`, `@1x`, `@octokit/request`, `x@latest`, une adresse électronique ; pas `undici@5.28.3`) ; `/` en début de mot (`/start`, `/var`), `./`, `../`, `~/` ; une adresse IP, **même pour expliquer** (`127.0.0.1`, choix du dirigeant) ; un domaine, à la règle des noms (seules des extensions de fichier connues passent : `Node.js`, `dev.ts`, `config/dev.ts` restent ; `README.md`, `t.me`, `evil.app` partent), quoi qui précède le point et signes vocaliques compris, comme pour Telegram (`evil~.com`, `example.भारत`).
- **Un point collé à une majuscule finit une phrase** (« vulnérable.Pour » devient « vulnérable. Pour ») : ce n'est ni un domaine, ni une phrase à perdre.

Mesure : des 56 réponses du banc du 20/10, une seule change (« (127.0.0.1) » retiré, sa phrase reste) ; aucune des 14 phrases fictives ordinaires ; les 27 pièges sont neutralisés. Ce que Telegram change en lien n'a pas été vérifié sur un vrai message : une IP nue et `/etc/pve` sont traités comme des liens, par prudence.

Hors de cette révision : les `#mot` et `$MOT` (des recherches dans Telegram, sans danger) ; une commande coupée entre deux phrases (« npm. install x » ne s'exécute plus) ; une commande absente de la forme (`csrutil enable`, un programme inconnu) ; une ligne qui commence par un nom de programme (« Tailscale n'est pas à jour… ») reste retirée entière par le filtre des lignes de commande, faux positif antérieur à ces révisions. Relevés par la relecture adverse, laissés à une révision suivante : des guillemets ou une barre oblique inverse cachent une commande à la forme (`sudo "reboot"`, `su\do reboot`, `npm 'i' x`) ; un tiret entre espaces après `ssh` ou `tailscale` (« Tailscale - ton VPN - est à jour ») est pris pour une option, et la phrase part ; un fichier d'extension inconnue de la liste (`cert.pem`, `server.key`, `index.html`) est retiré comme un domaine. Ces trois écarts et le filtre des lignes : voir la révision suivante.

## Révision du 2026-10-21 — guillemets, tirets, fichiers et lignes

Les quatre écarts laissés par la révision précédente, vérifiés par exécution : sur 20 pièges écrits avec des guillemets ou une barre oblique inverse, 19 passaient ; sur 22 phrases ordinaires (un tiret entre espaces, un nom de fichier, une ligne ouvrant sur « Tailscale » ou « Npm »), 21 étaient abîmées ou perdues. Une relecture adverse de la première version de cette révision a relevé une régression (un nom de fichier gardé complétait une commande), d'autres façons de cacher une commande et des faux positifs nouveaux : tout est traité ci-dessous.

- **Ni guillemets, ni barre oblique inverse, ni emphase Markdown, ni expansion du shell ne cachent une commande** : chaque phrase est jugée telle quelle, puis une seconde fois sans `"`, `'`, `\`, accent grave, guillemets typographiques ou plus rares (“ ” ‘ ’ « » „ ‹ › ❝ ❞ 「 」 ″…), ni `*` et `_` du Markdown — ceux que le shell retire, ceux qu'un lecteur saute : `sudo "reboot"`, `su\do`, `s'u'do`, `npm 'i' x`, `sudo “reboot”`, `sudo **reboot**`. Le premier jugement reste : sans son apostrophe, « l'npm install » ne serait plus un mot. Ce que le shell change en un mot ou en rien est une commande : `$'…'`, `${…}`, `s$1udo`, `{sudo,reboot}`. `sudo` compte aussi devant une variable (`sudo $SHELL`) ou l'historique du shell (`sudo !!`, `!-1`) ; pas devant un point, une barre, un tilde ou un tiret suivis d'un espace (« Ne lance jamais « sudo ». » reste). **Choix du dirigeant : les guillemets typographiques aussi**, même pour expliquer : « Le terme « sudo » désigne… » part, comme « les droits sudo sont trop larges ».
- **Un tiret entre espaces n'est pas une option** : après `ssh`, `tailscale`, `git`, `curl`, `wget`, `sudo`… seul un tiret collé en est une (`-p`, `--accept-routes`) ; « Tailscale - ton VPN - est à jour » reste. Sauf après `rm`, où un tiret seul est un nom de fichier (`rm - x` efface x).
- **Un nom de fichier dont l'extension n'est pas un domaine de premier niveau reste**, en pleine phrase comme entre accents graves : 66 extensions ajoutées, chacune absente de la liste de l'IANA (version 2026102000) — clés et certificats (`pem`, `key`, `crt`, `pfx`, `kdbx`, `ovpn`…), réglages (`cfg`, `npmrc`, `netrc`, `tfstate`…), code et pages web (`html`, `xml`, `css`, `sql`, `go`, `php`…), données (`csv`, `db`, `sqlite`, `bak`…). Restent des domaines, donc retirés : `.java` (le domaine d'Oracle), `.py`, `.sh`, `.md`, `.pub`, `.rs`, `.pl`, `.tf`, `.properties`, `.zip`, `.mov`, `.app`. Une extension de la liste qui deviendrait un domaine en sortirait. **Un fichier gardé ne complète jamais une commande** : un programme qui lance, ouvre, déplace ou efface le fichier nommé après lui est une commande (`rm cert.pem`, `go run main.go`, `open index.html`, `sqlite3 base.db`, `git apply x.patch`, `chmod a+r server.key`…), même pour expliquer.
- **Une ligne qui commence par une majuscule est de la prose** : le filtre des lignes de commande ne reconnaît plus un programme qu'en minuscules, comme on le tape (`npm publish`, `tailscale up`), et toujours une invite `$`, `#`, `>` en tête. « Tailscale n'est pas à jour : 1.90.1 installé » reste ; « Sudo reboot » part avec sa phrase, jugée comme les autres. **Choix du dirigeant**, confirmé après la relecture adverse, qui a montré que sur ce Mac les noms de fichier ignorent la casse (`Npm x left-pad-test` s'exécute) : la forme connaît les alias de npm (`x`, `in`, `isntall`…) et `npm publish`, en tête de ligne comme en pleine phrase ; une commande absente de la forme (« Curl srv-test-01 », « Tailscale logout ») n'est plus retirée d'office.
- **Les options devant la sous-commande de npm sont comptées, huit au plus** : une longue suite piégée se jugeait en un temps quadratique (20 ko : 225 ms, désormais 5 ms ; la réponse du modèle est de toute façon plafonnée à 400 jetons).

Mesure : des 56 réponses du banc du 20/10, aucune ne change (53 contiennent des apostrophes, 172 en tout) ; des 28 réponses du même banc rejoué sous Ollama le soir du 20/10, une change : la ligne « Tailscale, votre logiciel de réseau virtuel privé, est désynchronisé… » n'est plus perdue. Les 21 faux positifs fictifs sont levés, sans en créer parmi 7 phrases à apostrophes ni parmi les 34 de la révision précédente ; sur 18 autres phrases fictives, 3 partent au titre de la forme large (« un open index.html », « le paquet npm x », « les fichiers {a,b} »). Pièges neutralisés : les 27 de la révision précédente, 19 des 20 nouveaux (le vingtième, « \`s\`udo reboot », devient « udo reboot », qui n'est pas une commande), 22 des 24 de la relecture adverse (restent « Curl srv-test-01 » seul sur sa ligne et « N'utilise jamais sudo !! », retiré au titre de la forme large). Trente et une règles retirées une à une : chacune fait échouer des tests.

Hors de cette révision : des tours du shell plus rares (`=reboot` sous zsh, `s?do`, `sudo$u reboot`) ; « Tailscale -- ton VPN -- », dont le double tiret passe encore pour une option ; une commande absente de la forme, en tête de ligne avec une majuscule comme en pleine phrase (« Curl srv-test-01 », « Tailscale logout », `reboot` seul) ; une ligne qui commence par `- npm`, `% npm` ou un caractère invisible.

## Révision du 2026-10-21 — les modes de chmod

Le trou relevé pendant la révision précédente, antérieur à ces révisions et vérifié par exécution : « Lance chmod 777 secret maintenant. » sortait tel quel. Seul un mode d'un chiffre était reconnu (`chmod 7 x`), parce que la limite de mot commune suivait le premier chiffre ; `chmod +x` ne l'était qu'au titre des options.

- **`chmod` devant un mode est une commande, en chiffres comme en lettres**, tels que le `chmod` de ce Mac les accepte (essayé sur un fichier jetable) : des chiffres octaux avec autant de zéros de tête qu'on veut (`777`, `4755`, `00644`) ; des lettres — pour qui (`u`, `g`, `o`, `a`), un signe (`+`, `-`, `=`), quels droits (`r`, `w`, `x`, `X`, `s`, `t`, ou ceux d'un autre trio : `g+u`) — avec une liste vide (`go=` retire tout), plusieurs actions (`u+r-w`), plusieurs clauses (`u+x,g-w`) ou des signes à la suite (`=+r`, `==`, `=,u+r`). En fin de proposition aussi : « Lance chmod 777. » part. Au titre de la forme large, « Un chmod 777 serait trop large » part, même pour expliquer.
- **Un signe seul entre espaces est de la prose**, comme un tiret : « Les outils chmod + chown règlent les droits » reste (la forme d'avant le retirait), comme « chmod +/- ». Des lettres qui ne font pas un mode restent aussi : « Le chmod a-t-il été appliqué ? », « un chmod au hasard ». Le prix de ce choix : `chmod = x`, qui retire tous les droits du fichier, passe ; `chmod + x` et `chmod - x` ne changent rien.

Mesure : des 56 réponses du banc du 20/10 et des 28 du même banc rejoué sous Ollama, aucune ne change (aucune ne contient « chmod »). Pièges neutralisés : 33 sur 33, contre 4 avant ; la forme d'abord envisagée (`chmod\s+[0-7]{1,4}(?!\S)` et `chmod\s+[ugoa]*[+=-][rwxXst]+`) en laissait passer 8 (`00644`, `g+u`, `o=g`, `go=`, `a=`, « chmod 777. ») et retirait « Le chmod a-t-il été appliqué ? ». Sur 27 phrases fictives, 3 nouvelles partent au titre de la forme large, une est levée. Une relecture adverse a trouvé six modes à signes à la suite que la première version laissait passer (`=+r`, `==`, `=-`, `+=`, `=,u+r`, `+,u+s`), tous exécutés par le `chmod` de ce Mac : corrigés ; elle a ensuite neutralisé 29 pièges sur 30 (espaces insécables, chiffres pleine largeur, guillemets, barre oblique inverse, `$'…'`, Markdown, `/bin/chmod`, options), le trentième, `find . -exec chmod 777 {} +`, ne laissant que « Lance find . ». Treize mutations, une par règle : chacune fait échouer des tests. Une longue suite piégée se juge en quelques millisecondes.

## Révision du 2026-10-21 — chown, chgrp et chflags

Le trou laissé par la révision précédente, vérifié par exécution : `chown root secret`, `chown root:wheel secret`, `chgrp staff secret`, `chflags hidden secret` sortaient tels quels en pleine phrase.

- **Devant ce que ce Mac accepte, ce sont des commandes** (essayé sur un fichier jetable, sans `sudo`) : pour `chown`, un numéro (`0`, `+0`, `0501`), un compte de ce Mac (`root`, `nobody`, `daemon`, `_www`), un propriétaire et un groupe de part et d'autre d'un deux-points (`alice:staff`, `:wheel`, `root:`), une variable (`$USER`) ; pour `chgrp`, un numéro, un groupe de ce Mac (`wheel`, `admin`, `staff`, `everyone`, `nogroup`, `nobody`, `daemon`, `operator`, `_developer`), une variable ; pour `chflags`, un drapeau avec ou sans `no` (`hidden`, `nouchg`, `noschg`, et ceux que le manuel tait : `restricted`, `sunlink`, `dataless`…), en liste (`hidden,,uchg`, `", hidden"`), en octal ou en variable. `--` après `chgrp` ou `chflags` est une option. Au titre de la forme large, « Le chgrp staff ne suffit pas » part.
- **Devant un autre nom, c'est de la prose** : « le chown de root », « un chgrp trop large », « chown ou chmod », « chown 8.32 », « le chown _récursif_ » restent. Rien ne distingue « chown root secret » de « le chown de root » par la structure : compter deux mots quelconques retirait 27 phrases fictives sur 33. **Choix du dirigeant**, après la relecture adverse : un nom collé à un deux-points sans groupe est de la prose (« le chown récursif: tout le dossier… », « chown failed: … »). Le prix : un nom inconnu de la forme passe (`chown alice secret`, `chown alice: secret`, `chgrp developers secret`).

Mesure : aucune des 56 et 28 réponses des bancs ne change ; 58 pièges sur 59 neutralisés (2 avant) ; 6 phrases fictives sur 33 partent, toutes écrites comme une commande. La relecture adverse (174 pièges, 77 phrases) a fait corriger six pièges (`--`, `", hidden"`, `$X`, `sunlink`, `dataless`) et lever 5 faux positifs sur 13. Trente mutations : chacune fait échouer des tests.

Hors de cette révision : un nom ou un groupe absent de la forme, un chemin après le nom (`chown alice /etc/sudoers` laisse « chown alice ») ; restent retirés un nombre après le programme (« appelle chown 3 fois », « la page chflags 1 », « chown 3:00 ») et l'emphase sur plusieurs mots (« chgrp _par défaut_ ») ; les expansions sans lettre devant (`$#`, `$1`, `$[0]`, `{0..0}`) cachent encore une commande, `sudo` et `chmod` compris, comme avant ces révisions.

## Conséquences

- `npm audit` envoie la liste des dépendances au registre npm, `tailscale version --upstream` et `softwareupdate` interrogent leurs éditeurs : aucune donnée personnelle (registre, services tiers).
- Les constats ne contiennent aucune donnée de personne (paquets, réglages du Mac) ; ils ont malgré tout leurs durées : 365 jours après la clôture, 90 jours pour un risque accepté.

## Options écartées

- **Un agent qui corrige seul** : contraire à la charte, et un agent avec `sudo` est une porte.
- **Des commandes proposées par le modèle** : un avis ou un flux piégé pourrait lui en souffler une.
- **Une alerte à chaque passage** : du bruit ; seul ce qui change est dit, le reste attend le bilan du lundi.
