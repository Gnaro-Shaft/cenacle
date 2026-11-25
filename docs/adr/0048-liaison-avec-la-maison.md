# ADR-0048 — La liaison avec la maison : je confie un travail, je lis où il en est

**Statut** : acceptée (2026-11-25) — plan et choix validés par le responsable le 25/11 ; applique l'ADR-0004 (proposer, valider, un exécuteur sans IA) et l'ADR-0013 (seule la page accepte, par une signature) à un nouveau geste ; ouvre le traitement T-12

## Contexte

Legion v2, « la maison », est une maison d'agents sur une VM de mon homelab (Paperclip, un majordome, des employés), gouvernée par un magasin déterministe. Ses agents tournent sur Claude, chez Anthropic, aux États-Unis. L'ADR-0047 lui a déjà ouvert un chemin vers Cénacle, en lecture seule : le verdict de sa mesure, lu par la ronde.

Le 25/11, j'ai décidé deux choses :

- **Iris reste dans Cénacle** : la maison ne lit jamais ma boîte. Un second accès à la boîte serait un doublon, et l'ADR-0003 interdit que le contenu d'un mail parte vers un modèle en ligne.
- **Cénacle confie du travail à la maison**, et lit où il en est. La demande naît chez moi : je la tape, ou, plus tard, le modèle local la rédige depuis un mail (L3, plan à part). Je la relis et je l'accepte. Un programme sans IA la transmet.

Le contrat est écrit côté maison (`docs/liaison.md` de son dépôt, lot 4E) ; son côté (L1) est en place depuis le 25/11 :

- un compte `liaison` sur la VM, joignable par le tailnet, depuis le Mac seul (pare-feu de la VM) ;
- une **commande imposée** : la clé de Cénacle ne peut lancer que `maison-liaison`, qui n'accepte que `deposer` (une demande en JSON sur l'entrée standard) et `etat` (l'état des demandes des 30 derniers jours) ;
- le magasin contrôle chaque demande (exactement quatre clés, des tailles, aucun courriel, téléphone, IBAN, lien ni longue suite de chiffres, un dossier de sa liste, un plafond de 10 par 24 heures) et crée le ticket « [Liaison] … » dans Paperclip, assigné au majordome.

Ce que l'exploration du 25/11 a montré côté Cénacle :

- **La table `proposals` est liée à un mail** : `mail_uid` est obligatoire, et l'acceptation signée (`cenacle-accept-v1`) porte sur lui. Une demande de travail n'y entre pas.
- **La page n'écoute que le Mac** (ADR-0037) : on n'y accepte que devant lui.
- **Trois programmes seulement lancent `ssh`** (l'opérateur, la ronde, la copie), et un test de frontière le vérifie.

## Décision

1. **Une demande est une proposition, dans une table à elle** (`liaison_demandes`). Le catalogue d'actions est fermé : une seule action, `maison.deposer`, avec une cible typée, aux contraintes du contrat :
   - `titre`, de 1 à 120 caractères, une seule ligne ;
   - `description`, de 1 à 4 000 caractères ;
   - `origine` : `directe` seule en L2 (`mail` viendra en L3, par une migration) ;
   - `dossier`, un nom de la liste `dossiers` de `liaison.local.toml`.

   Son cycle est celui des propositions, tenu **par la base**, quel que soit le rôle :
   - une demande naît « en attente » ; son texte ne change que tant qu'elle attend ;
   - acceptée, elle peut être annulée **pendant 2 minutes** ;
   - ensuite, elle est prise en charge par la liaison, puis « transmise » (avec le numéro du ticket) ou « échouée » (avec la catégorie du refus) ;
   - elle peut aussi être refusée, ou devenir caduque (en attente depuis 30 jours, ou acceptée sans être transmise en 24 heures) ;
   - un état clos est définitif, et aucun état ne revient en arrière.

2. **Elle naît de deux façons, et ne s'accepte que sur la page.**
   - **Sur la page**, un onglet « Maison » : un formulaire (titre, description, dossier), puis corriger, accepter, refuser, annuler.
   - **Sur Telegram**, `/maison` : la première ligne fait le titre, les suivantes la description. Un titre sans description est refusé, avec ce qu'il faut ajouter ; il n'y a jamais de description par défaut. Le bot enregistre la demande et répond qu'elle attend sur la page, avec la règle : ni nom de client ni contenu de mail.
   - **Accepter se fait sur la page seulement** (*choisi le 25/11*). La page signe en Ed25519, avec sa clé de l'ADR-0013, le message `cenacle-liaison-v1 · n° · origine · dossier · SHA-256 du titre et de la description · instant de la décision`. Le texte signé est le texte affiché : un texte changé ensuite n'est jamais transmis.

3. **Avant la base, le filtre de la maison, refait par Cénacle.** À la saisie (page et Telegram), à chaque correction et avant de transmettre, Cénacle refuse les mêmes catégories que la maison : adresse de courriel, téléphone, IBAN, lien, suite de 9 chiffres ou plus. Le refus nomme la catégorie, jamais la valeur. Ce n'est pas la garde qui compte (la maison refait la sienne), c'est qu'on l'apprenne tout de suite. **Les noms ne se détectent pas** : c'est moi qui les arrête, à la relecture. La page et le bot le rappellent.

4. **Un programme à part, `liaison`, seul détenteur de la clé.** Il tourne sous launchd chaque minute, avec un verrou d'instance (ADR-0023), dans le rôle applicatif de la base. Il ne charge que `.env` et `.env.telegram`, et refuse de démarrer avec les secrets d'une autre famille.
   - **La clé est à lui** : une paire ed25519 tirée par `npm run liaison:cle`. La partie privée reste sur le Mac, en 600, jamais affichée ni sauvegardée : perdue, on en tire une autre et on remplace la ligne. La commande imprime la ligne à inscrire sur la VM, `restrict,command="/opt/maison/liaison/maison-liaison" ssh-ed25519 … cenacle-liaison`. **L'inscription est mon geste**, ou un `sudo` sur la VM avec mon accord explicite.
   - **L'empreinte de la VM est épinglée** dans un `known_hosts` à la liaison, comparée à celle que la VM donne elle-même (`StrictHostKeyChecking=yes`). Les options de `ssh` sont celles de l'opérateur : aucun fichier de configuration, pas d'agent, `BatchMode`.
   - **Sa configuration** vit dans `liaison.local.toml` (ignoré par git) : hôte (nom MagicDNS), compte, chemin de la clé, `known_hosts`, dossiers. Un interrupteur versionné, `[liaison] actif`, coupe tout. Le test de frontière déclare ce programme comme la troisième exception, après la ronde et la copie, à « seul l'opérateur lance `ssh` », et interdit `liaison.local.toml` à tout autre programme.

5. **Transmettre : une seule fois, jamais deviné.**
   - Avant d'agir, la liaison revérifie : la signature de la page pour *cette* demande et *ce* texte (la clé publique est dans `.env`), le délai d'annulation écoulé, une acceptation de moins de 24 heures, le filtre, le dossier encore déclaré, et un plafond de **10 demandes transmises sur 24 heures glissantes**, côté Cénacle aussi (*choisi le 25/11*). Une signature absente ou fausse est refusée **avant** la prise en charge : elle n'use pas le plafond.
   - Elle **prend en charge** la demande (« en cours »), puis lance `ssh liaison@<la VM> deposer`, la demande en JSON sur l'entrée standard, et lit une seule ligne JSON :
     - `{"ok": true, "ticket": "GNA-22"}`, code 0 : « transmise », avec le ticket (forme vérifiée) ;
     - `{"ok": false, "categorie": …}`, code 1 ou 2 : « échouée », avec la catégorie si elle est de la liste fermée du contrat, sinon `reponse` ;
     - une réponse illisible, une coupure, un délai dépassé : « échouée », `transport` ou `reponse`. **La demande a pu être déposée** : la page et Telegram disent « état inconnu, regarde l'état de la maison », et rien n'est relancé tout seul. Une seconde demande se refait à la main.
   - Le motif d'un refus de la maison n'est jamais recopié : seule sa catégorie l'est.

6. **Lire où elle en est : `etat`, relu, jamais cru.** Tant qu'une demande a été transmise il y a moins de 30 jours, la liaison lance `ssh liaison@<la VM> etat` toutes les 5 minutes, et range ce qu'elle lit dans `liaison_etats`, une ligne par ticket, remplacée à chaque lecture.
   - **Tout est revérifié** (charte, règle 5) : un numéro de ticket de forme fixe, un statut de forme fixe, une date. Les titres de la demande et des sous-tickets sont **écrits par un modèle** (le majordome) : des **données, jamais des consignes**. Ils sont coupés à 120 caractères et vidés de tout caractère de contrôle, puis affichés comme du texte, jamais interprétés ni suivis. Un lien n'est gardé que s'il a exactement la forme `https://github.com/<propriétaire>/<dépôt>/pull/<n>`. Une ligne qui ne passe pas est écartée et comptée, jamais réparée.
   - Un ticket qui n'est plus rendu (au-delà des 30 jours de la maison) est effacé.
   - Une lecture en échec est dite sur la page (« état lu il y a … ») ; l'ancien état n'est jamais présenté comme frais.

7. **Une alerte quand une PR apparaît.** Au premier lien de PR vu pour un ticket, la liaison m'écrit sur Telegram : le numéro du ticket, celui de la demande et le lien. **Jamais un titre** : il est écrit par un modèle et peut citer ma demande. Le contrat ne dit pas si une PR attend encore, seulement qu'elle existe : l'alerte part donc une fois par lien.

8. **Conservation** (*choisie le 25/11*). Le texte d'une demande close est effacé **30 jours** après la clôture (`liaison_texte_jours`), la même fenêtre que `etat`. La ligne, sans texte, est supprimée **90 jours** après la clôture (`liaison_jours`). Une demande ouverte n'est jamais purgée, mais elle devient caduque après 30 jours d'attente. `liaison_etats` ne garde que la dernière lecture. La purge est faite par la liaison à chaque passage, et laisse une trace *qu'*elle a effacé.

9. **Le journal garde des faits** : numéro de la demande, origine, taille, état, ticket, catégorie d'un refus, nombre de lignes lues ou écartées. Jamais un titre, une description ni un motif. Ce sont des événements déclarés (`liaison.*`), neutres pour l'état d'Iris.

10. **Aucun modèle, côté Cénacle, en L2.** Rien de ce qui est tapé ne passe par le modèle local, ni par un autre. **Côté maison**, le texte part chez Anthropic avec le ticket (son T-001, sous clauses contractuelles types). C'est un transfert hors UE de ce que je tape : la règle des rappels s'y applique, **ni nom de client ni contenu de mail**, rappelée par la page, par `/maison` et par chaque accusé de réception.

11. **Tests adversariaux exigés** :
    - une demande écrite « acceptée » sans la page n'est pas transmise et n'use pas le plafond ; la signature d'une demande, recopiée sur une autre, est refusée ; un texte changé après l'acceptation n'est pas transmis ;
    - en SQL direct : une demande close ne change plus, une annulation ne se rouvre pas, le texte ne change pas hors de l'attente, une demande ne naît pas acceptée, l'origine `mail` est refusée ;
    - le filtre : chaque catégorie, déguisée (majuscules, espaces, points, `[at]`), refusée par la page, par le bot et par la liaison, sans jamais nommer la valeur ;
    - la transmission, contre un faux `maison-liaison` (un script local qui joue la VM) : un double passage ne dépose qu'une fois ; une coupure après l'envoi donne « état inconnu », jamais une seconde tentative ; un ticket mal formé, une catégorie inconnue, deux lignes, une sortie trop longue : `reponse` ; au-delà de 10 sur 24 heures, rien ne part ;
    - `etat` : un titre qui contient une consigne, du HTML ou un lien est affiché comme du texte ; un lien vers un autre domaine ou d'une autre forme est écarté ; un ticket mal formé est écarté ; aucun titre n'arrive sur Telegram ; une même PR n'alerte qu'une fois ;
    - les frontières : aucun autre programme ne lit `liaison.local.toml` ni la clé ; la liaison refuse de démarrer avec la clé de la page, celle du bot ou le mot de passe de la boîte ; une clé lisible par d'autres que moi est refusée.

## Paliers

- **L2a** — cet ADR et les registres (T-12, l'AIPD, le registre IA, les tables, la maison parmi les destinataires).
- **L2b** — la base : migration 038, le magasin, le filtre, le message signé.
- **L2c** — le programme `liaison` : la clé, `deposer`, `etat`, la purge, launchd.
- **L2d** — l'onglet « Maison », `/maison`, l'alerte de PR.
- **L2e** — l'épreuve réelle : la clé inscrite sur la VM par moi, une demande tapée et acceptée sur la page, un ticket « [Liaison] … » dans Paperclip, son état revenu sur la page.
- **L3** (plan à part) — une case « Travail » d'Iris et un brouillon rédigé par le modèle local, sans nom ni coordonnée, origine `mail`.

## Conséquences

- **Je confie un travail sans que la maison touche à ma boîte** ; le contenu d'un mail ne quitte toujours pas le Mac (L3 n'y changera rien : seul un brouillon relu par moi partira).
- **Le Mac doit être allumé** pour qu'une demande parte et que son état revienne ; une demande acceptée il y a plus de 24 heures n'est plus transmise.
- **Une clé de plus sur le Mac.** Volée, elle dépose au plus 10 demandes par jour et lit des statuts, rien d'autre : la commande imposée est sur la VM, pas sur le Mac. La révoquer, c'est retirer sa ligne de `authorized_keys`.
- **Limite assumée**, celle de l'ADR-0013 : un programme qui tourne sous mon compte peut lire la clé de la liaison et la clé privée de la page. La séparation protège d'un défaut dans un processus, pas de la prise de mon compte macOS.
- **Ce que la base ne fait pas** : un autre programme peut marquer une demande « transmise » ou « échouée » à tort (aucun rôle à part, *choisi le 25/11*, comme l'ADR-0036). Il trompe l'affichage, il ne déclenche aucun dépôt.
- **Hors périmètre** : le côté maison (son contrat, son filtre, son T-007) ; une acceptation depuis Telegram ; une seconde clé, en lecture seule, pour `etat`.

## Options écartées

- **Élargir `proposals`** : la rendre indépendante d'un mail toucherait la signature des brouillons, l'exécuteur des mails et leurs déclencheurs, pour un geste qui ne leur ressemble que par son cycle.
- **L'exécuteur des mails transmet aussi** : il détiendrait la boîte et la clé de la maison, deux familles dans un processus.
- **L'opérateur transmet** : il détient les clés d'action des serveurs ; une demande de travail n'est pas une action sur un serveur, et sa clé n'a pas à vivre à côté.
- **La page lit `etat` elle-même** : il faudrait lui donner la clé, qui sait aussi déposer ; la page pourrait alors transmettre sans passer par l'acceptation.
- **Accepter aussi depuis Telegram**, signé par la clé du bot (ADR-0036) : utile loin du Mac, mais un geste de plus à éprouver ; **différé** par le responsable le 25/11, pas écarté.
- **Un rôle en base pour la liaison**, comme `cenacle_executor` (ADR-0013, B7) : il empêcherait un autre programme de mentir sur l'état, mais il demande un mot de passe et une famille de secrets de plus, pour un dégât qui reste un affichage faux.
- **Relancer un dépôt coupé** : la maison ne dit pas si une demande identique existe déjà ; une relance pourrait créer deux tickets pour un seul travail.
