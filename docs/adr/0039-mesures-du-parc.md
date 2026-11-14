# ADR-0039 — Les mesures du parc : charge, mémoire, disques et machines virtuelles

**Statut** : acceptée (2026-11-14)

## Contexte

L'onglet « Parc » de la page (14/11, #227) montre ce que Cénacle sait déjà : l'état de chaque serveur selon Legion, les constats de sécurité, la ronde et la sentinelle. Il ne montre **aucune mesure** : ni charge, ni mémoire, ni disques, ni les machines virtuelles de la grappe Proxmox. Je les ai demandées le 14/11, sur le modèle d'un tableau de bord de laboratoire maison, pour trois sources : Proxmox, le pare-feu et les serveurs Linux. Aucun outil ne les collecte aujourd'hui (ni Home Assistant, ni Netdata, ni Prometheus).

Ce qui existe déjà :

- **Legion récite ces mesures, mais Cénacle le remplacera.** Sa ronde (ADR-029 de Legion) demande toutes les 15 minutes à chaque machine un bulletin `clé=valeur`, par une clé SSH contrainte côté serveur (`command=…,restrict`) : `uptime`, charge, processeurs, mémoire, disques par point de montage. Son verdict n'en garde que les problèmes. Je ne veux pas investir dans Legion (14/11) : on **reprend son modèle**, pas son code ni ses accès.
- **Les actions de l'opérateur** (ADR-0027) ont déjà posé, sur les quatre machines, des clés de Cénacle verrouillées chacune sur un seul script (`command=`), installées par `deploy/serveurs/install.sh`.
- **La grappe Proxmox** (deux nœuds et un QDevice) a une API en HTTPS sur le tailnet, qui donne l'usage du processeur et de la mémoire de chaque nœud, l'état et la consommation de chaque machine virtuelle, les disques et leur usure, avec un **jeton en lecture seule** (rôle `PVEAuditor`).
- **Le pare-feu** : son modèle n'est pas encore connu.

## Décision

1. **Les serveurs Linux : un bulletin de Cénacle, en lecture seule.**
   - Un script `cenacle-bulletin`, porté du `legion-bulletin-hote` de Legion (et cité comme tel), récite entre `bulletin=1` et `fin=1` : `hote`, `instant`, `uptime`, `charge1`/`charge5`/`charge15` (×100), `processeurs`, `memoire.totale` et `memoire.disponible` (ko), et pour chaque disque local `disque.<n>.montage`, `disque.<n>.pourcent`. Rien d'autre : ni ports, ni journaux, ni noms d'utilisateurs.
   - Sa **propre clé**, verrouillée côté serveur sur ce seul script (`command="/usr/local/bin/cenacle-bulletin",restrict`), posée avec les autres par `deploy/serveurs/install.sh` ; **jamais** une clé d'action de l'opérateur (ADR-0027), qui peut, elle, changer la machine.
   - La clé privée, détenue par le **seul serveur de la page**, dans un fichier lisible par moi seul ; les machines reconnues par leur empreinte (`known_hosts` dédié, `StrictHostKeyChecking=yes`) : un hôte inconnu est refusé, jamais accepté au premier contact.
   - Une lecture stricte : un bulletin tronqué (sans `fin=1`), d'un autre hôte que celui demandé, ou hors forme est « illisible », jamais affiché à moitié.
2. **La grappe Proxmox : son API, en lecture seule.**
   - un utilisateur dédié, `cenacle@pve`, et un jeton à **séparation de privilèges**, avec le seul rôle `PVEAuditor` sur `/` : il voit, il ne peut rien changer ;
   - le jeton dans une famille de secrets à lui, `.env.proxmox`, chargée par le **seul serveur de la page** (ADR-0013) ;
   - en HTTPS, le certificat du nœud **épinglé** par son empreinte (dans `.env`, qui n'est pas secret) : jamais de vérification désactivée ;
   - quatre lectures seulement, chacune avec un délai court : l'état des nœuds, les ressources de la grappe (machines virtuelles et conteneurs : état, processeur, mémoire), la liste des disques avec leur usure, le nombre de mises à jour en attente ;
   - un nœud injoignable est dit « injoignable », jamais compté comme sain ; l'autre est lu quand même.
3. **L'instant présent seulement.** Les mesures sont lues à l'ouverture de l'onglet et toutes les minutes tant qu'il est ouvert (une seule lecture à la fois, gardée 30 secondes) ; **rien n'est conservé** : ni table, ni fichier, donc rien à purger. Un historique, pour des courbes, demanderait une autre ADR, avec sa durée de conservation.
4. **Le pare-feu attend** que son modèle soit connu : une ADR à part, sur le même modèle (un accès en lecture seule, une famille de secrets, un certificat épinglé).
5. **L'onglet « Parc » change de forme** : une carte par machine, comme sur le modèle — jauges de charge, de mémoire et de disques ; machines virtuelles sous chaque nœud Proxmox ; l'état selon Legion et ses motifs en dessous, tant que Legion tourne. Les cartes « Sécurité » et « Veille » restent.
6. **Vérifié par le code** : la clé et le jeton ne sont jamais dans une adresse, un journal ou une erreur ; un certificat ou une empreinte d'hôte qui ne correspond pas est refusé ; une réponse hors forme ou trop grosse rend « illisible » ; aucun programme d'autre que le serveur de la page ne peut charger `.env.proxmox` ; le script récitant ne lit que ce qu'il récite (relu, et essayé sur une machine).

### Révision du 2026-11-14 — la frontière `ssh` de l'ADR-0027

L'ADR-0027 fait de l'opérateur le seul programme qui lance `ssh` et détient des clés, et un test le vérifie dans tout le code. Elle protège les **clés d'action**, celles qui changent une machine. Le point 1 ci-dessus fait lire les bulletins par le serveur de la page, en `ssh` : une **exception étroite**, choisie le 14/11 plutôt que de faire relire les bulletins par l'opérateur et de les garder en base.

- Le serveur de la page lance `ssh` depuis **un seul fichier** (`apps/server/src/machines.ts`), avec `/usr/bin/ssh`, sans agent, avec les seules clés de `parc.local.toml` : des clés de **lecture**, verrouillées sur `cenacle-bulletin`.
- `parc.local.toml` est **un fichier à part** de `serveurs.local.toml` : l'opérateur reste seul à lire celui-ci et à connaître une clé d'action ; il ne lit jamais celui-là.
- Le test de frontière de l'opérateur le vérifie : `ssh` nulle part ailleurs ; ce fichier ne nomme ni `serveurs.local.toml`, ni une clé ou un script d'action ; l'opérateur ne lit pas `parc.local.toml`.
- L'identité de la machine est prouvée par son empreinte épinglée, pas par le nom qu'elle donne dans son bulletin.

### Révision du 2026-11-14 — le certificat de Proxmox, vérifié contre l'autorité de la grappe

Au lieu d'une empreinte dans `.env`, le serveur de la page vérifie le certificat du nœud **comme un navigateur le ferait**, mais contre la seule autorité de la grappe (`/etc/pve/pve-root-ca.pem`, copiée sur le Mac, `CENACLE_PROXMOX_CA`), et sur le **nom du nœud** que porte ce certificat (`CENACLE_PROXMOX_NODES=<nœud>@<adresse>:<port>`). C'est plus strict qu'une empreinte : un certificat renouvelé par la grappe reste accepté, un certificat d'une autre autorité ou pour un autre nom est refusé avant qu'aucune requête — donc aucun jeton — ne parte. La vérification n'est jamais désactivée ; un test le prouve avec une autorité étrangère.

## Conséquences

- Un pas de plus pour remplacer Legion : Cénacle a son propre bulletin des machines, que sa ronde de sécurité pourra reprendre ensuite à la place du verdict de Legion (une autre ADR).
- Deux accès de plus, **tous deux en lecture seule** : une clé SSH qui ne peut que réciter, un jeton Proxmox qui ne peut que voir. S'ils fuient, ils montrent le parc, ils ne le changent pas. À révoquer en cas de doute : la procédure de violation les nommera.
- Un geste par machine, à faire par moi : poser le script et la clé (`deploy/serveurs/install.sh`, comme pour les actions) ; dans Proxmox, créer l'utilisateur et le jeton (la marche à suivre dans `docs/securite/secrets.md`).
- Aucune donnée personnelle : des mesures de machines. Pas de tiers : les machines sont à moi, sur le tailnet. Pas d'IA.
- Travail : le script et sa clé (`deploy/serveurs`), un lecteur de bulletins et un lecteur Proxmox dans le serveur, la famille `.env.proxmox`, les cartes par machine, les tests.

## Options écartées

- **Faire porter les mesures par le verdict de Legion** : aucun nouvel accès, mais du travail dans un système que Cénacle remplacera (14/11).
- **Réutiliser une clé d'action de l'opérateur** : une clé qui peut mettre à jour ou redémarrer une machine ne doit pas servir à la regarder une fois par minute.
- **Prometheus, Netdata ou Home Assistant** : un outil de plus à installer, faire tourner et sécuriser, pour un écran ; à reconsidérer si un historique devient utile.
- **Désactiver la vérification du certificat de Proxmox**, auto-signé : un jeton envoyé à quiconque se fait passer pour le nœud. L'empreinte épinglée coûte une ligne.
