# ADR-0046 — Le retrait de Legion : sa confiance révoquée, ses traces retirées, ses données tranchées

**Statut** : proposée (2026-11-22) — fait suite à l'ADR-0040 (palier R4 : Legion arrêté le 22/11) et à l'ADR-0045 (ce qui devait survivre est rapatrié dans `deploy/homelab/`) ; tranche ce que l'ADR-0043, point 5, renvoyait à l'archivage de Legion (le sort des copies de ses bases)

## Contexte

Legion est arrêté depuis le 22/11 : ses minuteurs du conteneur qui le porte (« le conteneur de Legion ») et du nœud de sauvegarde sont désactivés, ses tâches du Mac aussi (`attente`, `rappels`, `ronde`, `veilleur`). Arrêté n'est pas retiré. Ce que ses `LISEZ-MOI` disent avoir posé (relus le 22/11 dans son dépôt ; jamais sa configuration réelle) est toujours là, et une part en est **de la confiance accordée à un système que plus personne ne surveille** :

- **Des clés encore acceptées.**
  - La clé de sa ronde, `/root/.ssh/ronde` sur le conteneur de Legion, est autorisée sur chaque machine qu'elle relevait (ligne `ronde-legion`, contrainte à `command="/usr/local/bin/legion-bulletin-hote",restrict`), dans le compte qui récite : `ronde` sur les nœuds, le compte de l'administrateur sur les VPS, et le conteneur lui-même.
  - La clé du veilleur, `/root/.ssh/veilleur-legion` sur le nœud de sauvegarde, est autorisée sur le conteneur de Legion (contrainte à `/usr/local/bin/legion-bulletin`).
  - La clé de la copie des bases, `/root/.ssh/copie-bases` sur le nœud de sauvegarde, est autorisée chez root sur le conteneur de Legion (contrainte à `rrsync -ro` sur le dossier des copies).

  Chacune est contrainte, en lecture seule. Mais une clé privée valide qui dort sur un serveur est un secret de plus à voler, et elle ouvre encore une porte quand rien ne la surveille plus.
- **Un compte et deux règles `sudo`** sur les nœuds Proxmox : le compte `ronde` (clé seule, membre de `systemd-journal`), `/etc/sudoers.d/ronde-grappe` (`pvecm status`) et `/etc/sudoers.d/ronde-redemarrages` (`needrestart -r l -b`).
- **Des fichiers et des unités** :
  - partout : `/usr/local/bin/legion-bulletin-hote`, `/var/lib/legion-ronde/` (son sel), `/etc/needrestart/conf.d/legion.conf` ;
  - sur le conteneur de Legion : `/usr/local/bin/legion-bulletin`, les unités `legion*.service|timer`, le code `/root/projects/legion` ;
  - sur le nœud de sauvegarde : `veilleur-legion.service|timer`, `copie-bases.service|timer`, leurs dossiers `/var/lib/veilleur-legion` et `/var/lib/copie-bases`.
- **Sur le Mac** : les tâches désactivées (`fr.gnaro.legion.*`), ses scripts de relève (`~/bin/relever-*.sh`), son verdict en cache.
- **Ses données.** Sa base, sur le conteneur de Legion (`/root/storage/legion/.legion`), ses jeux de copies quotidiens à côté, et leurs copies non chiffrées sur le nœud de sauvegarde (`/var/backups/legion-bases`). Son registre (`docs/conformite/registre-traitements.md`, T-001 à T-013) dit ce qu'elle porte : des chemins de mes fichiers, des domaines d'expéditeurs de la boîte professionnelle et leurs règles (T-002), des objets de messages en attente (T-006), mes rappels et demandes de mission (T-003, T-004), les adresses des sources qui frappent les serveurs publics (T-008). **Des tiers y figurent.** La finalité de chacun de ces traitements a pris fin le 22/11 ; les garder sans finalité contredit la limitation de la conservation (RGPD, art. 5.1.e).

Ce qui porte le nom de Legion **et reste, exprès** (ADR-0045, point 2 : on ne renomme pas sur les serveurs) : `/etc/apt/apt.conf.d/52legion-redemarrage` (le redémarrage automatique du VPS du site public, point 6), `/etc/udev/rules.d/90-legion-rebrancher-nic0.rules` (la carte réseau d'un nœud), les unités passagères `legion-maj-*` de `mettre-a-jour-un-noeud`. Ce ne sont plus des traces de Legion : ce sont des pièces de Cénacle au vieux nom.

## Décision

1. **La confiance d'abord, les fichiers ensuite, les données en dernier.** Ce qui ouvre un accès part avant tout le reste : les lignes de clés autorisées, puis les clés privées elles-mêmes, puis le compte `ronde` et ses deux règles `sudo`. Les fichiers et les unités ensuite. Les données en dernier, et seulement après le choix du point 4.

2. **De ma main, une machine à la fois.** Cénacle ne se connecte jamais en root (ADR-0039, 0040) et ne retire rien lui-même. Chaque machine suit le même pas : l'inventaire, le retrait, l'inventaire de nouveau. Une machine n'est pas commencée tant que la précédente ne dit pas « rien ne reste ».

3. **Un inventaire en lecture seule**, `deploy/homelab/retrait-legion/inventaire-legion`, lancé en root sur la machine :
   - il cherche une **liste fermée** de traces, relevée dans le dépôt de Legion : les lignes de clés qui le nomment (`ronde-legion`, `legion-bulletin`, `veilleur-legion`, `copie-bases`), dans les `authorized_keys` de root, du compte `ronde` et des comptes humains ; les clés privées `/root/.ssh/{ronde,veilleur-legion,copie-bases}` ; le compte `ronde` ; les deux règles `sudo` ; les fichiers et les unités nommés plus haut ; les dossiers de données ;
   - il dit, pour chacune, **présente, absente ou illisible** — jamais absente quand il n'a pas pu lire — et finit par « rien ne reste » ou la liste de ce qui reste ;
   - **il n'affiche aucun contenu** : ni clé, ni ligne de fichier, ni nom de fichier de données ; une ligne de clé se compte, un dossier de données se dit présent avec sa taille ;
   - **il n'écrit rien**, ne suit aucun lien symbolique, et **ignore les pièces gardées exprès** (ci-dessus) : un inventaire qui les signalerait pousserait à retirer ce qui sert.

   Le retrait lui-même se fait par les commandes du `README` du dossier, machine par machine, relues avant d'être lancées. Pour le Mac, une liste à cocher (ses tâches désactivées, ses scripts, son cache), sans script : le Mac n'a ni compte `ronde` ni `sudo` à retirer.

   Deux gardes dans ce `README` :
   - `/etc/needrestart/conf.d/legion.conf` ne part qu'après avoir vu `zz-cenacle.conf` à côté (posé par `deploy/serveurs/install.sh`) : sans lui, `needrestart` relancerait de nouveau les services tout seul ;
   - le paquet `sudo` reste sur les nœuds : le bulletin de Cénacle s'en sert.

4. **Les données : effacées, sans archive** (*proposé, à trancher*). Leur finalité a disparu avec Legion, et rien de ce qu'elles portent ne manque à Cénacle : les rappels ont été repris (ADR-0041, « rien à ressaisir »), l'état des machines est celui de la ronde de Cénacle. L'effacement porte sur la base du conteneur de Legion, ses jeux de copies, et les copies du nœud de sauvegarde.

   **L'autre voie** : une seule archive, chiffrée par une clé `age` à part (pas celle de la copie de Cénacle, ADR-0044), gardée hors du parc pour une durée fixée, puis effacée. Elle ne se justifie que si je veux pouvoir relire Legion ; je ne m'en connais pas de raison.

   **Les sauvegardes en gardent une trace**, et c'est dit plutôt que tu : les archives `vzdump` du conteneur de Legion (et leurs copies par `copie-dumps`) contiennent sa base jusqu'à ce que leur rétention les élague. On ne les efface pas à la main — elles portent tout le reste du conteneur — : la date où la dernière disparaît se relève sur le nœud (la rétention de la tâche `vzdump`), et se note ici, en précision datée, quand l'effacement est fait.

   **Rien n'est exporté avant l'effacement**, sauf si je le demande : le seul candidat serait la liste des règles par expéditeur (T-002, des domaines), pour les reposer un jour dans Cénacle.

5. **Le registre de Legion se ferme dans Legion.** Quand ses données sont effacées, son registre dit, pour chaque traitement, « clos le <date> : données effacées » (une PR dans le dépôt de Legion, comme son bandeau « Déménagé dans Cénacle »). Le registre de Cénacle ne change pas : ce retrait ne crée aucun traitement, il en termine.

6. **Aucune donnée de personne ne passe par Cénacle.** L'inventaire ne lit aucun contenu ; il ne sort de chaque machine que des noms fixes, des « présente/absente » et des tailles. Rien ne remonte au Mac que ce que je recopie de l'écran.

7. **Tests adversariaux exigés** (`inventaire-legion`, sur une racine factice) :
   - chaque trace de la liste est trouvée, présente ou absente, et la sortie le dit ;
   - une machine propre finit par « rien ne reste », une machine où une seule trace reste ne le dit jamais ;
   - un fichier illisible se dit illisible, jamais absent ;
   - aucun octet d'une clé, d'une ligne de `authorized_keys` ou d'un fichier de données n'apparaît dans la sortie ;
   - un lien symbolique n'est pas suivi ; une ligne de clé sans le nom de Legion n'est pas comptée ;
   - les pièces gardées exprès (`52legion-redemarrage`, `90-legion-rebrancher-nic0.rules`, `legion-maj-*`) ne sont jamais signalées ;
   - le script n'écrit nulle part (racine en lecture seule) et ne contient aucune commande qui modifie.

## Paliers

- **L0** — cet ADR, pour relecture.
- **L1** — `deploy/homelab/retrait-legion/` : l'inventaire, ses tests, le `README` des retraits par machine et la liste du Mac.
- **L2** — de ma main : la confiance, machine par machine (inventaire avant et après).
- **L3** — de ma main : les fichiers et les unités.
- **L4** — de ma main, après le choix du point 4 : les données. Puis la précision datée sur les archives `vzdump`.
- **L5** — le registre de Legion fermé (une PR dans Legion), puis son dépôt archivé sur GitHub, par moi.

## Conséquences

- **Plus aucune porte ouverte par Legion** : plus de clé de Legion acceptée, plus de compte `ronde`, plus de règle `sudo` à son nom. Le parc n'accepte que les clés de Cénacle, contraintes à son bulletin et à son catalogue.
- **La ronde de Cénacle ne change pas** : ni port, ni bulletin. La ligne grise `copie-bases` de la rubrique « Sauvegardes » disparaît avec `/var/lib/copie-bases`.
- **Des données de tiers effacées** plutôt que gardées sans raison, et une date pour la dernière trace dans les sauvegardes.
- **Ce qui disparaît avec Legion, et qu'il faut savoir** :
  - la note « mails sans réponse depuis cinq jours » (sa tâche `attente`) n'a pas d'équivalent dans Cénacle : Iris compte les messages en attente, sans la liste par expéditeur. À reprendre ou non, par un autre ADR ;
  - Myriade lisait `/api/en-attente` de Legion pour son point du matin (son ADR-009) : cette source n'existe plus depuis le 22/11. À vérifier, et à corriger, dans Myriade.
- **Hors périmètre** : le miroir du coffre (`fr.gnaro.legion.miroir`, que Mnemo lit) reste, son déménagement est une autre décision ; `fr.gnaro.copie-dumps` s'arrête à S3 (ADR-0043), pas ici ; le compte de l'administrateur ajouté à `systemd-journal` sur les VPS reste : c'est mon compte, pas une trace.

## Options écartées

- **Laisser en place, puisque tout est contraint en lecture seule** : le plus court, mais des clés valides que personne ne surveille, sur un parc qui ne les utilise plus.
- **Un script qui retire tout seul** : une commande irréversible par machine, lancée d'un bloc. L'inventaire en lecture seule et des commandes relues une à une laissent voir chaque retrait avant qu'il se fasse.
- **Le retrait par Cénacle** (une action du catalogue) : il faudrait à Cénacle des droits root qu'il n'a jamais eus, pour un geste fait une seule fois.
- **Garder les données « au cas où »** : c'est précisément ce que la limitation de la conservation interdit.
