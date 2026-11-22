# ADR-0043 — La veille des sauvegardes : lue par la ronde, sans root, sans Legion

**Statut** : acceptée (2026-11-17) — reprend la veille des ADR-024, 025 et 027 de Legion (« la copie des sauvegardes », « le canal d'alerte des sauvegardes », « la copie des bases de Legion ») ; étend l'ADR-0040 (le bulletin, version 3)

## Contexte

Cénacle remplacera Legion (10/10). L'inventaire du 16/11 a relevé ce que Legion fait encore et que Cénacle ne fait pas : la **veille des sauvegardes** en tête. L'agenda est fait (ADR-0042) ; c'est le suivant.

Ce que fait la chaîne de Legion (lue le 17/11 dans son dépôt : ses ADR, `deploiement/copie-dumps`, `copie-bases`, `sauvegardes` ; jamais sa configuration réelle) :

- **Sur les serveurs, sans Legion** : vzdump sauvegarde les machines du parc sur le disque du nœud qui les porte ; `copie-dumps` les copie chaque nuit d'un nœud Proxmox vers le serveur de sauvegarde (et `copie-dumps-retour` dans l'autre sens), ne garde que des archives vérifiées (`zstd -t`), n'élague que ce qui a passé la vérification ; `veiller-les-sauvegardes` demande au cluster, en lecture seule, si la tâche de sauvegarde tourne et réussit ; `copie-bases` tire les copies des bases de Legion et vérifie chacune (`PRAGMA integrity_check`). Une autre copie, celle de la base de Myriade, vit dans le projet Myriade.
- **Chacun écrit un verdict**, remplacé d'un bloc (`.partiel` puis `mv`), sur un socle commun — `verdict=SAIN|MALADE`, `instant=` (un entier), `depuis=` (un entier, ou `-` quand le verdict est SAIN), des lignes répétables `motif=`, puis `fin=1` — et **des clés propres à chaque source** : la copie des archives dit `libre_go`, `pool_pct`, `gardees`, `controles`, `corrompus`, `invite` ; la veille des tâches dit `invites`, `noeud` ; la copie des bases dit `gardes`, `fautifs`, `ecrit_le`, `jeu` ; celle de Myriade dit `chiffre`, `dernier`, `taille_octets`, `gardes`, `elagues`. Cinq verdicts en tout, sur les deux nœuds Proxmox (l'un d'eux est aussi le serveur de sauvegarde).
- **Leurs motifs sont du texte libre** : des messages de `rsync`, de `ssh`, de `pvesh` ou d'une exception Python, des chemins d'archives. Ils peuvent contenir des adresses IP et des noms d'hôtes.
- **Un seul programme en fait une alerte** : `relever-la-copie.sh`, sur le Mac, lancé toutes les heures par `fr.gnaro.copie-dumps`. Il lit les cinq verdicts **en root par SSH** (le second nœud par rebond depuis le serveur de sauvegarde), tolère un échec de lecture par source, tient pour périmé un verdict de plus de trois jours, et signale un verdict daté du futur. L'alerte est une note du coffre (« ⚠ Les sauvegardes ne vont pas ») et une notification ; la note s'efface quand tout redevient sain. Les courriels d'alerte de Proxmox ne partent pas (port 25 fermé) et n'ont pas été réparés.

Ce qui en découle :

- **Arrêter les agents de Legion tait toute alerte de sauvegarde.** Le script n'utilise rien de Legion (ni Python, ni base, ni bot), mais il est livré par son dépôt sous son étiquette `fr.gnaro.*`.
- **Arrêter Legion lui-même rend une source malade pour toujours** : la copie de ses bases (sa tâche `sauver`) cesse, et `copie-bases` le dit au bout de trois jours (« la maison n'en produit plus »).
- **Les écueils qu'elle a payés**, à ne pas refaire : une archive en cours d'écriture copiée à 03:00 et dite saine (23/10 : d'où les `.dat`/`.tmp` exclus et la copie déplacée à 04:15) ; des archives de machines virtuelles ignorées par un motif de nom trop étroit pendant que le verdict disait SAIN ; un pool fin plein alors que `df` montrait de la place (31/10) ; une sauvegarde manuelle qui masque une tâche planifiée arrêtée ; un nom de jeu qui n'est pas sa vraie date (la fraîcheur se juge sur l'heure des fichiers).
- **Ses documents ont dérivé** : horaires périmés dans les commentaires (« 03:00 et 03:30 » alors que la copie tourne à 04:15), listes de machines sauvegardées qui se contredisent, un texte d'alerte qui parle de « deux copies » quand il y a cinq sources. Cénacle ne recopie pas ces listes : elles se déclarent dans sa configuration locale.

Une difficulté que Legion n'avait pas : **Cénacle ne se connecte jamais en root** (ADR-0039, 0040). Ses clés de lecture n'ouvrent que `cenacle-bulletin`, sous le compte `cenacle`.

## Décision

1. **Le bulletin récite l'état des sauvegardes présentes sur sa machine, jamais leurs motifs** (`cenacle-bulletin`, version 3). Pour chaque source d'une liste **fermée, écrite dans le script** — `copie-dumps`, `veiller-sauvegardes`, `copie-bases`, `myriade-base`, chacune avec son chemin fixe sous `/var/lib/` —, si le fichier existe :
   - `sauvegarde.<source>.verdict=SAIN|MALADE`, `.instant=` (entier), `.depuis=` (entier, ou absent quand le verdict dit `-`), `.motifs=<nombre de lignes motif>` ;
   - **aucun texte de motif** : ils portent des adresses et des noms d'hôtes (messages de `rsync`, de `ssh`, de `pvesh`), et le bulletin n'en récite jamais (ADR-0039, ADR-0040, point 1). Masquer des adresses dans un texte libre est fragile ; un nombre ne fuit rien. Le détail se lit sur le serveur, par moi (`cat /var/lib/<source>/verdict`), et la page me donne cette commande ;
   - le fichier est lu **contre la liste de clés de sa source** (le socle commun, plus les clés propres relevées dans les scripts de Legion et de Myriade) : seules les lignes connues comme répétables (`motif`, `invite`, `invites`, `jeu`, `noeud`) peuvent revenir ; un fichier sans `fin=1`, avec deux `verdict=`, une clé inconnue, un `instant` non entier ou un `depuis` ni entier ni `-` se récite `sauvegarde.<source>.lecture=illisible`, jamais comme un verdict ; un lien symbolique n'est pas suivi.

   **Lecture directe, sans `sudo` et sans root** : le compte `cenacle` lit le fichier comme n'importe quel compte. Aucune unité systemd de ces scripts ne fixe `UMask=`, la valeur par défaut est `0022`, et leurs dossiers et fichiers sont créés par `mkdir -p` et une redirection : ils devraient être lisibles par tous. C'est plausible, pas vérifié depuis le Mac : je le vérifie avant le palier S1 (`sudo -u cenacle cat /var/lib/<source>/verdict` sur chaque nœud), **et de nouveau après une nuit**, parce que chaque passage remplace le fichier. Si un fichier ne l'est pas, la correction se fait **chez l'écrivain** (une surcharge `UMask=0022` de son unité) ou sur son dossier, jamais par un `chmod` du fichier, que le passage suivant effacerait.

   - *Précisé le 19/11 (ADR-0044, B2)* : une cinquième source, **`copie-cenacle`** (la copie de la base de Cénacle, `/var/lib/copie-cenacle/verdict`, écrit par `veiller-copie-cenacle`), ses clés `gardes`, `refusees`, `derniere` ; le Mac la connaît avant que le serveur la récite.

2. **La ronde juge.** Les sources attendues se déclarent par machine dans `parc.local.toml` (non versionné) : `sauvegardes = ["copie-dumps", "veiller-sauvegardes", …]`. La ronde rend la machine MALADE, avec un motif qui nomme la source, quand une source attendue :
   - dit MALADE ;
   - manque, ou est illisible ;
   - a un verdict plus vieux que **36 heures**, mesuré contre l'`instant` du bulletin (l'horloge du serveur, pas celle du Mac) ;
   - est datée de plus de 5 minutes dans le futur, contre ce même `instant`.

   Toutes les sources écrivent chaque nuit (entre 03:30 et 04:15 pour celles de Legion, minuteurs `Persistent=true` ; chaque jour pour celle de Myriade) : une nuit sans verdict se voit le lendemain, au lieu de trois jours avec Legion. **Ce délai ne veille que les écrivains** : qu'une tâche vzdump n'ait plus produit d'archive se juge toujours dans leurs scripts, à dix jours (`copie-dumps`, `veiller-les-sauvegardes`), et la ronde le voit quand leur verdict passe MALADE.

   Une source présente mais non déclarée est montrée, jamais jugée. Une machine qui déclare des sources et dont le bulletin n'en récite aucune (versions 1 et 2) est MALADE (« bulletin trop ancien »), jamais saine par défaut.

3. **L'alerte passe par le chemin existant, avec son propre type.** Un motif de sauvegarde devient un constat de l'agent sécurité à la deuxième observation, que le bot m'envoie sur Telegram et que le rapport du matin reprend. Il reçoit **son type, `sauvegarde`** (cible : la machine et la source), et **un titre en mots fixes** — « <machine> : sauvegarde <source> MALADE », « … illisible », « … sans verdict depuis 36 h » —, jamais le motif de la ronde recopié : le bot et le rapport envoient le titre tel quel, et il dure 365 jours après la clôture dans `securite_constats`. Le constat se referme quand la source redevient saine ; il ne se corrige pas par un bouton : aucune action sur les serveurs n'en découle.

   Deux règles de l'agent sécurité en tiennent compte :
   - **la preuve de l'opérateur** (`hostAnswered`) compte une machine MALADE pour ses seules sauvegardes comme **une machine qui a répondu** : sans cela, une sauvegarde en panne ferait croire qu'un serveur ne revient pas après un redémarrage, et arrêterait un plan de maintenance ;
   - **la comparaison des deux rondes** (ADR-0040, point 3) ignore le type `sauvegarde` : la ronde de Legion ne le connaît pas, chaque constat serait une fausse différence.

4. **Après la bascule de la ronde, pas avant.** Tant que `securite.toml` dit `source = "legion"`, l'agent sécurité n'ouvre de constats que d'après le verdict de Legion : un constat de sauvegarde de Cénacle n'existerait pas. Le jugement (S2) attend donc que la source soit `cenacle` (ADR-0040, R3, à partir du 23/11). Ensuite, **pendant au moins sept jours**, les deux veilles tournent : celle de Legion (sa note du coffre) et celle de Cénacle (ses constats). Quand elles disent la même chose, **j'arrête `fr.gnaro.copie-dumps`** (`launchctl bootout` puis `disable`, le fichier gardé, réversible) et j'efface la note du coffre. Rien sur les serveurs ne change à cette étape.

5. **La source « bases de Legion » part avec Legion.** Au palier R4 de l'ADR-0040, quand j'arrête Legion : je retire `copie-bases` de `parc.local.toml`, puis j'arrête son minuteur sur le serveur de sauvegarde (`systemctl disable --now copie-bases.timer`). Les copies déjà faites restent là où elles sont ; leur sort se décide avec l'archivage de Legion, pas ici.

6. **Aucune donnée personnelle, aucun tiers, aucune IA.** Des faits de machines : des mots, des dates, des nombres — et, par le point 1, aucune adresse. Le bulletin et le verdict de la ronde sont écrasés à chaque passage ; seuls les constats durent, dans `securite_constats` comme les autres, avec leur titre en mots fixes. Aucun modèle ne lit ni ne juge ces verdicts. Rien à inscrire aux registres.

7. **Tests adversariaux exigés** :
   - pour chacune des quatre sources, **un verdict SAIN et un verdict MALADE réels** (relevés dans les scripts, adresses remplacées) sont lus, et leurs motifs ne sont jamais récités ;
   - `depuis=-` est accepté ; plusieurs `motif=` aussi ; une clé d'une autre source, une clé inconnue, un verdict tronqué ou en double, un `instant` non entier rendent `illisible`, jamais SAIN ;
   - une source hors de la liste fermée, un chemin autre que le sien, un lien symbolique ne sont jamais lus ; le bulletin n'utilise pas `sudo` pour les sauvegardes (épreuve sur le code) ;
   - un bulletin de quatre sources reste sous la taille maximale qu'accepte le Mac (16 Kio) ;
   - le Mac lit un bulletin version 3 **avant** qu'un seul serveur ne soit mis à jour (il refuse aujourd'hui tout ce qui n'est pas 1 ou 2) ;
   - une source attendue absente, illisible, MALADE, périmée (36 h et une seconde, contre l'`instant` du bulletin) ou datée du futur rend la machine MALADE ; une source non déclarée ne la rend jamais malade ; un bulletin version 2 sur une machine qui déclare des sources est MALADE ;
   - le titre du constat ne contient que des mots fixes, la machine et la source ;
   - une machine MALADE pour ses seules sauvegardes compte comme ayant répondu (`hostAnswered`) ;
   - la comparaison des deux rondes ignore le type `sauvegarde`.

## Paliers

- **P0** — cet ADR, pour relecture.
- **S1** — le lecteur du Mac accepte la version 3 ; puis le bulletin version 3, à installer par moi sur les deux nœuds, après la vérification des droits du point 1. La page n'en montre rien de plus.
- **S2** — une fois la ronde basculée sur `cenacle` (ADR-0040, R3) : le jugement, `sauvegardes = […]` dans `parc.local.toml`, le type de constat `sauvegarde`, la preuve de l'opérateur et la comparaison ajustées, la rubrique « Sauvegardes » de l'onglet Parc ; la veille de Legion continue.

  *Précision du 22/11, au code de S2 :* la ronde a basculé le 22/11 et Legion est arrêté (ADR-0040, R4) : **la comparaison des deux rondes n'existe plus**, il n'y a rien à y ajuster (point 3). S2 se fait en deux PR : **S2a**, le jugement, la clé `sauvegardes`, le type `sauvegarde` et la preuve de l'opérateur ; **S2b**, la rubrique de l'onglet Parc. Les constats `sauvegarde` sont de gravité **élevée** (*choisi le 22/11*) : un échec de la nuit arrive avec le rapport du matin, il ne réveille pas. Le motif « bulletin trop ancien » devient lui aussi un constat `sauvegarde` (occurrence `bulletin`), pour qu'une machine qui a répondu ne passe jamais pour une machine absente.
- **S3** — après sept jours et ma vérification : l'arrêt de `fr.gnaro.copie-dumps` et de sa note, par moi.

## Conséquences

- **L'alerte survit à l'arrêt de Legion**, et arrive sur Telegram plutôt que dans le coffre. Elle arrive plus tôt quand un écrivain se tait (36 h au lieu de trois jours) ; pour une tâche vzdump arrêtée, elle arrive quand les scripts le disent, comme aujourd'hui.
- **Cénacle n'a toujours aucun accès root** : la veille de Legion lisait en root, celle de Cénacle lit en compte ordinaire, par la clé qui n'ouvre que le bulletin.
- **Le motif ne se lit plus depuis le Mac** : Legion le copiait dans sa note ; Cénacle donne la commande pour le lire sur le serveur. Un pas de plus quand une sauvegarde est malade, aucune adresse sur le Mac ni sur Telegram.
- **Le bulletin grandit** de quelques lignes par source. Volée, la clé de lecture montre aussi l'état des sauvegardes ; elle ne les change toujours pas.
- **La veille dépend toujours du Mac** pour alerter, comme celle de Legion : la ronde tourne sur le Mac. Mac éteint, rien n'alerte ; la sentinelle (S2) dit déjà quand le Mac se tait.
- **Hors périmètre, à décider à part** :
  - les scripts serveurs (`copie-dumps`, `copie-bases`, `veiller-les-sauvegardes`) restent dans le dépôt de Legion : à rapatrier dans `deploy/` de Cénacle, nettoyés de leurs adresses, avant l'archivage de Legion ;
  - la documentation de Myriade nomme `relever-la-copie.sh` comme lecteur de son verdict : à mettre à jour, dans Myriade, à S3 ;
  - restic, sur le serveur de sauvegarde, n'écrit aucun verdict : la veille ne le voit pas ;
  - l'état du pool fin du serveur de sauvegarde n'est pas jugé à part ; c'est lui qui a causé l'incident du 31/10 (la copie des archives le dit dans son verdict au-delà de 90 %) ;
  - **la base de Cénacle n'est pas sauvegardée** (décidé le 04/10) ; des tables qui ne se relisent pas sont arrivées depuis (rappels, cartes de prospection, archive de la veille). C'est une autre question, pour un autre ADR.

## Options écartées

- **Porter `relever-la-copie.sh` tel quel dans Cénacle** : le plus court, mais il lit en root par SSH et par rebond, et garderait un second chemin vers les serveurs à côté de la ronde.
- **Réciter les motifs en masquant les adresses** : plus commode à lire, mais un masque sur du texte libre (messages de `rsync`, de `ssh`, d'exceptions) en laisse toujours passer une forme ; un nombre n'en laisse passer aucune.
- **Une règle `sudo` qui lit les verdicts** (`cat` de chemins fixes) : possible si les fichiers ne sont pas lisibles, mais une règle de plus quand un masque de création suffit.
- **Juger les tâches vzdump directement par le jeton Proxmox en lecture seule** (ADR-0039) : il le pourrait, et plus tôt que dix jours ; mais il ne voit pas les copies entre nœuds ni celles des bases, qui restent à lire. À reconsidérer quand les scripts serveurs seront rapatriés.
- **Un nouveau programme de veille sur le Mac** : un détenteur de clés de plus, quand la ronde lit déjà chaque machine toutes les 5 minutes.
- **Faire alerter les serveurs eux-mêmes** (un courriel, un bot à eux) : Proxmox n'arrive déjà pas à envoyer ses courriels ; un bot par serveur multiplierait les jetons Telegram. La sentinelle a son bot parce qu'elle doit parler quand le Mac se tait ; ici, le Mac qui se tait est déjà signalé.
- **Garder la note du coffre** : Cénacle ne touche pas au coffre.
- **Trois jours de péremption, comme Legion** : plus tolérant, sans raison — toutes les sources écrivent chaque nuit.
