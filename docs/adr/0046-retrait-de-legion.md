# ADR-0046 — Le retrait de Legion : sa confiance révoquée, ses traces retirées, ses données tranchées

**Statut** : acceptée (2026-11-22) — fait suite à l'ADR-0040 (palier R4 : Legion arrêté le 22/11) et à l'ADR-0045 (ce qui devait survivre est rapatrié dans `deploy/homelab/`) ; tranche ce que l'ADR-0043, point 5, renvoyait à l'archivage de Legion (le sort des copies de ses bases)

## Contexte

Legion est arrêté depuis le 22/11 : ses minuteurs sur le conteneur qui le porte (« le conteneur de Legion ») et sur le nœud de sauvegarde sont désactivés, ses tâches du Mac aussi (`attente`, `rappels`, `ronde`, `veilleur`). Arrêté n'est pas retiré. Ce que son dossier `deploiement/` et son registre disent avoir posé (relus le 22/11 dans son dépôt ; jamais sa configuration réelle) est toujours là, et une part en est **de la confiance accordée à un système que plus personne ne surveille**.

**Des accès chez des tiers.** Son fichier d'environnement, sur le conteneur, porte l'identifiant IMAP de la boîte professionnelle (son registre, T-002) et un mot de passe d'application iCloud pour le calendrier (son ADR-020). Effacer le fichier ne révoque ni l'un ni l'autre : **ils restent valides chez OVH et chez Apple** tant qu'on ne les y révoque pas.

**Des clés encore acceptées**, chacune contrainte, en lecture seule — mais une clé privée valide qui dort sur un serveur est un secret de plus à voler, et elle ouvre encore une porte que plus rien ne surveille :
- la clé de sa ronde, `/root/.ssh/ronde` sur le conteneur, autorisée sur chaque machine qu'elle relevait (ligne `ronde-legion`, contrainte à `command="/usr/local/bin/legion-bulletin-hote",restrict`), dans le compte qui récite : `ronde` là où son script de pose est passé, le compte de l'administrateur sur les VPS ;
- la clé du veilleur, `/root/.ssh/veilleur-legion` sur le nœud de sauvegarde, autorisée chez root sur le conteneur (contrainte à `/usr/local/bin/legion-bulletin`) ;
- la clé de la copie des bases, `/root/.ssh/copie-bases` sur le nœud de sauvegarde, autorisée chez root sur le conteneur (contrainte à `rrsync -ro` sur le dossier des copies).

**Un compte et des règles `sudo`**, partout où son script de pose est passé (les nœuds, et le conteneur lui-même, « la ronde chez elle ») : le compte `ronde` (clé seule, membre de `systemd-journal`), `/etc/sudoers.d/ronde-redemarrages` (`needrestart -r l -b`), et sur les nœuds seulement `/etc/sudoers.d/ronde-grappe` (`pvecm status`).

**Un proxy qui survit** : `tailscale serve --bg --https=443` vers `127.0.0.1:8787`, posé pour sa fenêtre sur le conteneur. Il persiste après l'arrêt du service.

**Des fichiers et des unités** :
- partout où la ronde est passée : `/usr/local/bin/legion-bulletin-hote`, `/var/lib/legion-ronde/` (son sel), `/etc/needrestart/conf.d/legion.conf` ;
- sur le conteneur : `/usr/local/bin/legion-bulletin`, les unités `legion*.service|timer`, le code `/root/projects/legion` et son fichier d'environnement ;
- sur le nœud de sauvegarde : `veilleur-legion.service|timer`, `copie-bases.service|timer`, `/usr/local/bin/veilleur-legion`, `/usr/local/bin/copier-les-bases`, leurs documents `/root/veilleur/` et `/root/copie-bases/`, les clés publiques `/root/.ssh/{veilleur-legion,copie-bases}.pub`, les dossiers `/var/lib/veilleur-legion` et `/var/lib/copie-bases`.

**Sur le Mac** : les tâches `fr.gnaro.legion.{attente,rappels,ronde,veilleur}` (désactivées) ; leurs scripts `~/bin/relever-la-ronde.sh`, `relever-le-veilleur.sh`, `relever-l-attente.sh`, `rediger-la-note.py`, `sonner-les-rappels.py` ; leurs journaux `~/Library/Logs/legion-{attente,rappels,ronde,veilleur}.log` ; leurs caches `~/Library/Caches/fr.gnaro.legion.{ronde.verdict,ronde.echecs,veilleur.echecs}` et `legion-cloche/`. **Pas** `fr.gnaro.legion.miroir` (Mnemo s'en nourrit), **pas** `relever-la-copie.sh` ni `fr.gnaro.copie-dumps` (ils tournent jusqu'à S3, ADR-0043).

**Ses données.** Sa base, sur le conteneur (`/root/storage/legion/.legion`), ses jeux de copies quotidiens à côté, et leurs copies non chiffrées sur le nœud de sauvegarde (`/var/backups/legion-bases`). Son registre (T-001 à T-013) dit ce qu'elles portent : des chemins de mes fichiers, des **domaines d'expéditeurs** de la boîte professionnelle et leurs règles (T-002), mes rappels et demandes de mission (T-003, T-004), des **empreintes pseudonymes** des sources qui frappent les serveurs publics (T-008) — et rien des objets de messages (T-006 : rien n'est conservé). **Des tiers y figurent**, sous forme de domaines et d'empreintes. Ailleurs encore :
- **le coffre** porte les notes qu'il écrivait : « ⚠ Messages sans réponse » (des domaines d'expéditeurs) et « 🔔 Rappels sonnés » (des textes de rappels) ; sa tâche `attente` laissait sa note en place quand le serveur ne répondait pas, elle peut y rester pour toujours ; le coffre se synchronise au téléphone et le miroir le donne à Mnemo ;
- **le calendrier iCloud** qu'il possède (son T-003) porte des événements avec le texte des rappels ;
- **Myriade** en garde 30 jours dans sa conversation (`/api/en-attente`, `/api/agenda`, son T-004) ;
- **les journaux** systemd de ses unités, sur le conteneur et le nœud de sauvegarde ;
- **les sauvegardes** : les archives `vzdump` du conteneur, et leurs copies par `copie-dumps`.

La finalité de chacun de ces traitements a pris fin le 22/11 ; les garder sans finalité contredit la limitation de la conservation (RGPD, art. 5.1.e).

**Ce qui porte le nom de Legion et reste, exprès** — ce sont des pièces de Cénacle au vieux nom (ADR-0045, point 2 : on ne renomme pas sur les serveurs) : `/etc/apt/apt.conf.d/52legion-redemarrage` (le réglage du redémarrage automatique du VPS du site public, ADR-0045, point 6) ; `/etc/udev/rules.d/90-legion-rebrancher-nic0.rules`, avec `rebrancher-nic0.service|timer` et `/usr/local/sbin/rebrancher-nic0` qu'elle déclenche ; `/usr/local/bin/attendre-la-grappe`, dont les unités de `copie-dumps` et de `sauvegardes` ont besoin ; les unités passagères `legion-maj-*` de `mettre-a-jour-un-noeud`.

## Décision

1. **Les accès d'abord, les fichiers ensuite, les données en dernier.**
   1. **Chez les tiers** : le mot de passe d'application iCloud de Legion révoqué chez Apple ; son accès IMAP révoqué chez OVH. S'il partage son identifiant avec un autre lecteur de la boîte (Iris), on change le mot de passe et on met ce lecteur à jour le même jour — c'est à vérifier avant, dans les réglages de la boîte, pas dans les fichiers de Legion.
   2. **Sur le parc** : les lignes de clés autorisées, puis les clés privées et publiques, puis le compte `ronde` (`userdel -r`, son dossier et ses clés avec) et ses règles `sudo`, puis le proxy `tailscale serve`.
   3. **Les fichiers et les unités.**
   4. **Les données**, selon le point 4.

2. **De ma main, une machine à la fois.** Cénacle ne se connecte jamais en root (ADR-0039, 0040) et ne retire rien lui-même. Chaque machine suit le même pas : l'inventaire, le retrait, l'inventaire de nouveau. Une machine n'est pas commencée tant que la précédente ne dit pas « rien ne reste ».

3. **Un inventaire en lecture seule**, `deploy/homelab/retrait-legion/inventaire-legion`, lancé en root sur une machine du parc :
   - il cherche une **liste fermée** de traces, celles du contexte : les lignes de clés qui nomment Legion (`ronde-legion`, `legion-bulletin`, `veilleur-legion`, `copie-bases`) dans les `authorized_keys` de root, de `ronde` et des comptes humains ; les clés de Legion sous `/root/.ssh/` ; le compte `ronde` ; ses règles `sudo` ; un gestionnaire `tailscale serve` vers `127.0.0.1:8787` ; les fichiers, les dossiers et les unités nommés ;
   - il dit, pour chacune, **présente, absente ou illisible** — jamais absente quand il n'a pas pu lire — et finit par « rien ne reste » ou la liste de ce qui reste ;
   - **il n'affiche aucun contenu** : ni clé, ni ligne de fichier, ni nom de fichier de données ; une ligne de clé se compte, un dossier de données se dit présent avec sa taille ;
   - **il n'écrit rien**, ne suit aucun lien symbolique, et **ignore les pièces gardées exprès** : un inventaire qui les signalerait pousserait à retirer ce qui sert.

   Le retrait se fait par les commandes du `README` du dossier, machine par machine, relues avant d'être lancées. Pour le Mac et pour les tiers, une liste à cocher, sans script : ses noms exacts (les globs `fr.gnaro.legion.*` et `relever-*.sh` emporteraient le miroir et la relève des copies). Ses gardes :
   - `/etc/needrestart/conf.d/legion.conf` ne part qu'après avoir vu `zz-cenacle.conf` à côté (`deploy/serveurs/install.sh`) : sans l'un ni l'autre, `needrestart` relancerait les services tout seul ;
   - le paquet `sudo` reste : le bulletin de Cénacle s'en sert ;
   - avant de retirer le proxy, `tailscale serve status` : si le port 443 ne servait que Legion, il disparaît, et `tailnet/tcp/443` sort des ports attendus du conteneur dans `parc.local.toml` le même jour, sinon la ronde le dit SOUFFRANT ;
   - `/var/lib/copie-bases` ne part qu'**après S3** : `relever-la-copie.sh` le lit jusque-là.

4. **Les données : effacées, sans archive** (*tranché le 22/11*). Leur finalité a disparu, et rien de ce qu'elles portent ne manque à Cénacle : les rappels ont été repris (ADR-0041, « rien à ressaisir »), l'état des machines est celui de la ronde de Cénacle. L'effacement porte sur :
   - la base du conteneur, ses jeux de copies, son fichier d'environnement, et les copies du nœud de sauvegarde ;
   - les notes de Legion dans le coffre, effacées par moi (Cénacle ne touche pas au coffre) ;
   - le calendrier iCloud de Legion, supprimé chez Apple ;
   - **puis un `fstrim`** — `pct fstrim` du conteneur depuis son nœud, `fstrim` du volume des copies sur le nœud de sauvegarde : sur un volume fin, un fichier effacé reste lisible sur le disque tant que ses blocs ne sont pas rendus.

   *Précision du 24/11, au bilan de L2 à L4 :* les paliers L2, L3 et L4 sont faits, de ma main, les 23 et 24/11 : chez les tiers, sur les cinq machines du parc, sur le Mac et dans le coffre. L'inventaire dit « rien ne reste » partout, **sauf sur le nœud de sauvegarde**, qui garde jusqu'à S3 ce que le point 3 lui réserve : `copie-bases.service|timer` (arrêtés, désactivés) et `/var/lib/copie-bases`. Ailleurs, les copies `/root/*.avant-legion` des fichiers de clés sont effacées ; sur ce nœud, les siennes, s'il en a, ne partiront qu'avec eux. Trois écarts au texte :
   - **Pas de `fstrim` sur le nœud de sauvegarde.** Ses copies des bases n'étaient pas sur un volume fin, mais sur le volume système du nœud : un volume classique, sur un disque à plateaux, sans `discard`. `fstrim` y est refusé. Les blocs effacés restent donc sur le disque jusqu'à ce que d'autres écritures les recouvrent : les relire demande le root sur le nœud ou le disque en main. C'est accepté (*choisi le 24/11*) : réécrire tout l'espace libre remplirait le volume système d'un nœud de la grappe en service, et les sauvegardes du conteneur gardent de toute façon les mêmes données jusqu'à leur rotation. Celui du conteneur a bien rendu ses blocs.
   - **`/root/storage/legion` reste**, sans `.legion` : il porte aussi la projection des projets du miroir, gardé (« Hors périmètre », plus bas). Le `rmdir` du `README` l'aurait refusé, comme prévu.
   - **Une trace hors de la liste fermée** : une ancienne copie d'un minuteur de Legion, à côté de ses unités sur le conteneur, que systemd ignorait et que l'inventaire ne voyait pas. Elle est retirée avec les unités. L'inventaire ne cherche toujours que sa liste.


   **Ce qui s'efface seul, et quand** — dit plutôt que tu :
   - Myriade : ses 30 jours, au plus tard le 22/12 ;
   - les journaux systemd : à la rotation de chaque machine (`journalctl --disk-usage` et la limite de `journald` donnent l'horizon) ; pas de purge ciblée, qui emporterait les journaux de tout le reste ;
   - **les sauvegardes du conteneur** : `vzdump` les élague selon sa rétention, et `copie-dumps` **par nombre** (les trois dernières copies vérifiées par invité) — la dernière trace part donc après trois nouvelles sauvegardes du conteneur, pas à une date. Deux exceptions à vérifier : une copie qui a échoué ou n'a jamais été vérifiée n'est jamais élaguée, et un conteneur détruit garderait ses anciennes copies pour toujours (on ne le détruit pas ici). On ne les efface pas à la main — elles portent tout le reste du conteneur. Quand la dernière est partie, une précision datée le dit ici.

   **Rien n'est exporté avant l'effacement**, sauf si je le demande : le seul candidat serait la liste des règles par expéditeur (T-002, des domaines), pour les reposer un jour dans Cénacle.

5. **Le registre de Legion se ferme dans Legion.** Quand ses données sont effacées, son registre dit, pour chaque traitement, « clos le <date> : données effacées » (une PR dans son dépôt, comme son bandeau « Déménagé dans Cénacle »). Le registre de Cénacle ne change pas : ce retrait ne crée aucun traitement, il en termine.

6. **Aucune donnée de personne ne passe par Cénacle.** L'inventaire ne lit aucun contenu ; il ne sort de chaque machine que des noms fixes, des « présente/absente » et des tailles. Rien ne remonte au Mac que ce que je recopie de l'écran.

7. **Tests adversariaux exigés** (`inventaire-legion`, sur une racine factice) :
   - chaque trace de la liste est trouvée, présente ou absente, et la sortie le dit ;
   - une machine propre finit par « rien ne reste » ; une machine où une seule trace reste ne le dit jamais ;
   - un fichier illisible se dit illisible, jamais absent ;
   - aucun octet d'une clé, d'une ligne de `authorized_keys` ou d'un fichier de données n'apparaît dans la sortie ;
   - un lien symbolique n'est pas suivi ; une ligne de clé sans le nom de Legion n'est pas comptée ;
   - les pièces gardées exprès (`52legion-redemarrage`, `90-legion-rebrancher-nic0.rules`, `rebrancher-nic0.*`, `attendre-la-grappe`, `legion-maj-*`, `zz-cenacle.conf`) ne sont jamais signalées ;
   - le script n'écrit nulle part (racine en lecture seule) et ne contient aucune commande qui modifie.

## Paliers

- **L0** — cet ADR, pour relecture.
- **L1** — `deploy/homelab/retrait-legion/` : l'inventaire, ses tests, le `README` des retraits par machine, la liste du Mac et celle des tiers.
- **L2** — de ma main : les accès chez les tiers, puis la confiance sur le parc, machine par machine.
- **L3** — de ma main : les fichiers et les unités ; `/var/lib/copie-bases` après S3.
- **L4** — de ma main : les données, le coffre, le calendrier, le `fstrim`. Puis la précision datée sur les sauvegardes.
- **L5** — le registre de Legion fermé (une PR dans Legion), puis son dépôt archivé sur GitHub, par moi.

## Conséquences

- **Plus aucune porte ouverte par Legion** : ni chez OVH ou Apple, ni sur le parc. Le parc n'accepte que les clés de Cénacle, contraintes à son bulletin et à son catalogue.
- **La ronde de Cénacle ne change pas**, sauf peut-être le port 443 du conteneur (point 3). La ligne grise `copie-bases` de la rubrique « Sauvegardes » disparaît avec `/var/lib/copie-bases`.
- **D'ici S3, la relève des copies du Mac dira `copie-bases` périmé** : son minuteur est arrêté depuis le 22/11, et `relever-la-copie.sh` tient un verdict pour périmé au bout de trois jours. Attendu, sans danger : S3 arrête cette relève.
- **Des données de tiers effacées** plutôt que gardées sans raison, et un horizon dit pour chaque trace qui s'efface seule.
- **Ce qui disparaît avec Legion, et qu'il faut savoir** :
  - la note « mails sans réponse depuis cinq jours » (sa tâche `attente`) n'a pas d'équivalent dans Cénacle : Iris compte les messages en attente, sans la liste par expéditeur. À reprendre ou non, par un autre ADR ;
  - Myriade lisait `/api/en-attente` et `/api/agenda` de Legion pour son point du matin : ces sources n'existent plus depuis le 22/11. À vérifier, et à corriger, dans Myriade.
- **Hors périmètre** : le miroir du coffre (`fr.gnaro.legion.miroir`) reste, son déménagement est une autre décision ; `fr.gnaro.copie-dumps` s'arrête à S3 (ADR-0043), pas ici ; le compte de l'administrateur ajouté à `systemd-journal` sur les VPS reste : c'est mon compte, pas une trace.

## Options écartées

- **Laisser en place, puisque tout est contraint en lecture seule** : le plus court, mais des clés et des mots de passe valides que personne ne surveille.
- **Un script qui retire tout seul** : une commande irréversible par machine, lancée d'un bloc. L'inventaire en lecture seule et des commandes relues une à une laissent voir chaque retrait avant qu'il se fasse.
- **Le retrait par Cénacle** (une action du catalogue) : il faudrait à Cénacle des droits root qu'il n'a jamais eus, pour un geste fait une seule fois.
- **Garder les données « au cas où »** : c'est précisément ce que la limitation de la conservation interdit.
- **Une archive chiffrée** (une clé `age` à part, hors du parc, une durée fixée) : elle ne se justifierait que pour relire Legion un jour, et je ne m'en connais pas de raison (*écartée le 22/11*).
- **Effacer les sauvegardes du conteneur à la main** : elles portent tout le reste du conteneur ; leur rotation suffit, avec son horizon dit.
