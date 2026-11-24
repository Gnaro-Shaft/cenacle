# ADR-0047 — La mesure de la maison : un verdict de plus pour la ronde, lu sans aucun autre droit

**Statut** : acceptée (2026-11-24) — étend l'ADR-0043 (la liste fermée des verdicts que récite le bulletin, et leur jugement par la ronde) ; suit l'ADR-0040 (la ronde) et l'ADR-0039 (le compte `cenacle` et sa clé de lecture)

## Contexte

Legion v2, « la maison », tourne sur sa propre VM du homelab : Paperclip et deux agents. Son plan prévoyait d'envoyer une mesure de la qualité de ses agents vers le Grafana de Cénacle (sa décision n° 20). C'est irréalisable tel quel : Cénacle n'a pas de chaîne de métriques (son Grafana est local au Mac, il ne reçoit que des traces, et les ADR 0039 et 0040 ont écarté Prometheus).

La maison mesure donc elle-même : chaque lundi à 7 h UTC (minuteur `maison-mesure.timer`, `Persistent=true`), elle écrit un bilan de la semaine et **un verdict au format de la ronde**, `/var/lib/maison/mesure/verdict` : `verdict=SAIN|MALADE`, `instant=`, `depuis=`, des lignes `motif=`, `fin=1`. Ses motifs sont de forme fixe : `cout-hebdo-<x>-usd`, `echecs-<n>-sur-<m>`. Son registre des traitements (T-002) dit que Cénacle ne lira ce verdict qu'une fois ce branchement inscrit chez lui.

Relevé le 24/11, en lecture seule, sur la VM :

- **Le verdict n'était pas au format de l'ADR-0043** : `instant` et `depuis` en dates ISO-8601 au lieu d'entiers, `depuis` daté même quand SAIN, plusieurs motifs joints sur une ligne, `motif=aucun` quand tout va bien. Le bulletin l'aurait dit `illisible`.
- **Son dossier est fermé** : `/var/lib/maison/mesure` en `0750 root:root`, ses fichiers en `0644`, remplacés d'un bloc (fichier temporaire, puis renommage). Le dossier parent est ouvert (`0755`).
- **Le pare-feu de la VM** n'accepte, par le tailnet, que le Mac, sur les ports 22 et 443 : la ronde part du Mac, c'est compatible.
- **La VM n'est pas un serveur sur lequel Cénacle agit** : ni `needrestart`, ni grappe, ni action prévue. `install.sh` pose pourtant toujours les trois scripts d'action et leurs règles `sudo`.

## Décision

1. **La maison corrige son verdict, Cénacle n'apprend pas un second format** (*choisi le 24/11*). Le verdict de la maison prend la forme commune de l'ADR-0043 : `instant` et `depuis` en secondes (entiers, UTC), `depuis=-` quand il est SAIN, une ligne `motif=` par motif, aucune quand il est SAIN. La correction se fait dans le dépôt de la maison, pas ici. Tant qu'elle n'est pas faite, la ronde dit la maison MALADE, « illisible » : jamais SAINE par défaut.

2. **Une sixième source, `maison`, dans la liste fermée** du bulletin (`cenacle-bulletin`) et du Mac (`bulletin-backups.ts`), lue à **son** chemin fixe, `/var/lib/maison/mesure/verdict`, et non sous `/var/lib/<source>/`. Elle n'a aucune clé propre : le socle commun seul. Elle est lue exactement comme les autres : jamais le texte d'un motif, seulement leur nombre ; un lien n'est pas suivi ; une clé inconnue, un instant qui n'est pas un entier, un `depuis` après l'`instant` la rendent `illisible`.

   Les noms restent ceux de l'ADR-0043 — les clés `sauvegarde.maison.*` du bulletin, la liste `sauvegardes = [...]` de `parc.local.toml`, le type de constat `sauvegarde` — bien que ce ne soit pas une sauvegarde : renommer toute la chaîne pour une source ne vaut pas les migrations de constats et de pages qu'il faudrait. Ce qui se lit change, en revanche :
   - **le titre du constat** dit « <machine> : mesure de la maison MALADE » (… « illisible », « sans verdict », « sans verdict depuis 8 jours », « datée du futur »), jamais « sauvegarde maison » ;
   - **sa gravité est `moyen`** (*choisi le 24/11*), pas `eleve` : une semaine de coûts ou d'échecs n'est pas une sauvegarde perdue ;
   - **la commande donnée** pour lire les motifs est `sudo cat /var/lib/maison/mesure/verdict` : le dossier n'est ouvert qu'au compte du bulletin.

3. **Huit jours, pas trente-six heures** (*choisi le 24/11*). La ronde juge chaque source selon le rythme de son écrivain : chaque nuit pour les cinq de l'ADR-0043 (36 h, inchangé), **chaque semaine pour la maison : 8 jours**, mesurés contre l'`instant` du bulletin comme les autres. Un lundi manqué se voit le mardi suivant ; le minuteur rattrape de lui-même un lundi où la VM était éteinte (`Persistent=true`). Le motif dit « sans verdict depuis 8 j ».

4. **Un compte qui ne fait que regarder : `install.sh --bulletin-seul`.** Sur une machine que Cénacle regarde sans jamais y agir, il crée le compte `cenacle` (sans mot de passe, son seul groupe) et pose le bulletin, **rien d'autre** : aucun script d'action, aucune règle `sudo`, ni la garde de `needrestart` (le bulletin ne s'en sert que par `sudo`). Il **refuse** une machine qui porte déjà les actions de Cénacle (`/etc/sudoers.d/cenacle`), un compte placé dans un autre groupe, et un `sudo` qui accorde quoi que ce soit au compte, par quelque règle que ce soit (il le demande, sans rien lancer). La clé est celle de l'ADR-0039 : `command="/usr/local/bin/cenacle-bulletin",restrict,from="<le Mac>"`, et l'empreinte de la VM est épinglée dans le `known_hosts` de Cénacle, comparée à celle que la VM donne elle-même.

   *Précisé le 24/11, à la première ronde (M2)* : sans `sudo`, le bulletin ne peut pas compter les services qui tournent sur une bibliothèque remplacée, et la ronde dit alors la machine SOUFFRANTE pour toujours (« services à redémarrer non récités ») — jamais saine par défaut, à juste titre. **Choisi le 24/11** : plutôt que de ne pas juger les services de la VM, `--bulletin-seul` pose aussi ce que le bulletin demande sur tout serveur (ADR-0040) — la garde de `needrestart` (lister, jamais relancer), `needrestart` exigé, et **la seule règle `sudo` en lecture** `needrestart -r l -b`, dans un fichier à elle, `/etc/sudoers.d/cenacle-bulletin` (et `pvecm status` sur un nœud de grappe, comme ailleurs). Les règles sont vérifiées comme dans l'installation complète : la forme permise passe, toute autre est refusée, et au moindre doute le fichier est retiré. Toujours aucun script d'action, aucune règle pour l'un d'eux.

5. **Le compte traverse le dossier, il ne le lit pas** (*choisi le 24/11*) : une ACL, `setfacl -m u:cenacle:--x /var/lib/maison/mesure` (paquet `acl`). Elle permet d'ouvrir le verdict par son nom, jamais de lister le dossier ; aucun autre compte n'y gagne rien. Elle survit au remplacement du verdict (elle est sur le dossier, pas sur le fichier) et à un `chmod 0750` du dossier. Contrairement à l'ADR-0043, point 1, la correction n'est pas faite chez l'écrivain : la maison ferme son dossier exprès, et le compte de Cénacle ne doit en obtenir que le passage. Limite connue : un bilan de la semaine (`bilan-<année>-<semaine>.json`, `.md`, en `0644`) se lirait aussi par son nom, deviné — il ne dit que des coûts et des comptes d'exécutions. Si une réinstallation de la maison effaçait l'ACL, ou fermait le dossier davantage, le bulletin dirait la source `illisible`, et la ronde la maison MALADE.

6. **Aucune donnée personnelle, aucune IA de plus.** Le bulletin ne récite qu'un mot, deux dates et un nombre ; les motifs restent sur la VM, et ne disent que des montants et des comptes d'échecs. Aucun modèle ne lit ce verdict côté Cénacle. Rien à inscrire aux registres de Cénacle. **Côté maison**, son T-002 est à mettre à jour une fois le branchement fait : « lu par Cénacle » (c'est au dépôt de la maison de le faire).

7. **Tests adversariaux exigés** :
   - le vrai bulletin, dans un conteneur Debian, en compte `cenacle` : le verdict lu à travers l'ACL ; le dossier jamais listé ; sans l'ACL, `illisible` ; un verdict MALADE dont les motifs ne sortent jamais ; le format de la maison du 24/11 (dates ISO), une clé inconnue, deux verdicts, un `depuis` après l'`instant`, un mot qui n'est pas un verdict, un lien : `illisible`, jamais un verdict ; ni verdict ni dossier : rien de récité ; un verdict à côté du dossier : jamais lu ;
   - le vrai `install.sh --bulletin-seul` : le compte, le bulletin, la garde de `needrestart` et sa seule règle, rien d'autre ; `needrestart -r l -b` permis, toute autre forme et toute autre commande refusées ; le bulletin récite le nombre de services à relancer ; relancé, rien de plus ; refusé pour un argument inconnu, un autre compte que root, des actions déjà posées, `needrestart` absent, une règle ailleurs qui accorde davantage (et sa propre règle alors retirée), le compte dans un autre groupe ;
   - sur le Mac : la source lue et déclarée comme les autres, un nom approchant refusé ; SAIN à 7 jours, encore dans les temps à 8 jours pile, MALADE à 8 jours et une seconde ; les sources de nuit gardent leurs 36 h, leur titre et leur gravité ; le constat de la maison a son titre et la gravité `moyen`, et ne s'ouvre qu'à la seconde observation ; la page dit « 8 jours » et donne la commande avec `sudo`.

## Paliers

- **M1** — cet ADR et le code de Cénacle (une PR) ; le Mac connaît la source **avant** que la VM ne la récite, sinon le bulletin entier lui est illisible (ADR-0043). Après la fusion : le serveur et la ronde relancés.
- **M2** — sur la VM : `install.sh --bulletin-seul`, le paquet `acl` et l'ACL, la clé et son épinglage ; la machine dans `parc.local.toml` (`sauvegardes = ["maison"]`, ses ports relevés au premier bulletin).
- **M3** — la correction du format, dans le dépôt de la maison, déployée et un verdict réécrit (`systemctl start maison-mesure.service`) ; alors seulement la ronde peut montrer la maison SAINE. Puis T-002, côté maison.

## Conséquences

- **La qualité de la maison arrive par le chemin existant** : un constat sur Telegram et dans le rapport du matin quand elle va mal, la rubrique « Sauvegardes » de l'onglet Parc, sans métriques ni Grafana.
- **Le compte `cenacle` de la VM ne peut rien changer** : une seule commande par `sudo`, qui liste sans relancer ; ni action, ni liste du dossier de la maison. Volée, sa clé montre l'état de la VM et le verdict de la semaine ; elle ne change rien.
- **Une semaine de retard au plus** : le verdict ne dit que la semaine écoulée ; un agent qui déraille un mardi se voit le lundi suivant. C'est le rythme que la maison a choisi, pas celui de la ronde.
- **Le mot « sauvegarde » couvre désormais un verdict qui n'en est pas un** dans les clés et la configuration ; les titres et la page disent le vrai nom.
- **Hors périmètre** : le dépôt de la maison (son format, son T-002), Paperclip ; une seconde source qui n'est pas une sauvegarde ferait reconsidérer les noms (« verdicts veillés » plutôt que « sauvegardes »).

## Options écartées

- **Le bulletin lit aussi les dates ISO, pour la seule maison** : pas de dépendance à la maison, mais un second format dans un script qui n'en connaît qu'un, et une conversion de dates en bash de plus à éprouver ; la maison voulait écrire le format de la ronde.
- **36 heures pour tous** : la maison serait MALADE six jours sur sept.
- **`install.sh` tel quel** : il poserait trois scripts d'action et leurs règles `sudo` sur une machine où Cénacle n'agit pas.
- **Ne pas juger les services de la VM** (une clé de `parc.local.toml`) : le compte serait resté sans aucun `sudo`, mais personne n'aurait vu des services de la VM tourner sur une bibliothèque remplacée.
- **Un groupe dédié qui possède le dossier** : changer le propriétaire d'un dossier de la maison, et donner au compte la liste du dossier.
- **Une copie lisible du verdict, faite par un minuteur root** : une unité de plus sur la VM, et un verdict en retard sur l'original.
- **Une règle `sudo` qui lit le verdict** : une règle là où le passage dans un dossier suffit.
