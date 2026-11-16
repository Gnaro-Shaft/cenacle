# ADR-0042 — L'agenda : lu à la demande, jamais retenu, sans Legion

**Statut** : proposée (2026-11-16) — reprend l'ADR-020 de Legion (« L'agenda : lu à la demande, et jamais retenu ») ; ouvrirait le traitement T-11

## Contexte

Cénacle remplacera Legion (10/10, redit le 14/11). L'inventaire du 16/11 a montré ce que Legion fait encore et que Cénacle ne fait pas ; le 16/11, j'ai choisi de porter d'abord **l'agenda** : « qu'est-ce que j'ai demain ». C'est le troisième pied de ce que je demandais à Legion — mes mails, mes rappels, mon emploi du temps — et le seul que Cénacle n'a pas.

Ce que Legion fait, et que cet ADR reprend (son ADR-020, son code `legion/agenda/`, `legion/lien/caldav.py`, `legion/lien/ical.py`) :

- **l'agenda est lu au moment où je pose la question, et rien n'en est gardé** : ni intitulé, ni heure, ni identifiant. Pas de base, donc pas de durée de conservation ni de purge ;
- il est lu en **CalDAV**, en HTTPS seulement, auprès des serveurs où mes agendas vivent déjà (un compte personnel, un compte professionnel) ; seuls les calendriers qui portent des événements sont lus ;
- d'un rendez-vous, il ne garde que **l'intitulé (200 caractères au plus) et les heures** ;
- **le code ne sait pas écrire** dans un agenda, et une épreuve le vérifie en lisant le code ;
- **la récurrence n'est pas réimplémentée** : le serveur étend les séries ; un événement qui porte encore sa règle (`RRULE`) est écarté, avec son motif ;
- **une heure qu'on ne sait pas situer est écartée, jamais supposée** ; une journée entière reste une date ;
- **une adresse annoncée par le serveur n'est pas suivie sans contrôle** : chaque requête porte le mot de passe ;
- **un agenda en panne est nommé, les autres sont rendus** ;
- des bornes : 8 Mio par réponse, 30 s par requête ; 7 jours par défaut, 31 au plus ; une section de sa page, rafraîchie toutes les **15 minutes**.

Ce que Legion fait aussi, et que cet ADR **ne reprend pas** : l'écriture des rappels dans un calendrier (son ADR-021 — les rappels de Cénacle sonnent déjà sur Telegram, ADR-0041) et la conciergerie qui accorde la lecture compte par compte (Cénacle n'en a pas : un compte non déclaré n'est pas lu, c'est le refus par défaut de la charte). Et ce que Cénacle **resserre** après relecture du code de Legion (16/11) : Legion reçoit l'événement entier et le découpe ; il admet tout l'hôte privé de son premier label ; ses motifs d'écart citent 40 caractères de l'événement ; sa fenêtre ajoute des jours de 24 heures à l'heure de la machine. Chacun est repris plus étroitement ci-dessous.

Une difficulté que Legion n'avait pas : **Telegram**. Un intitulé peut nommer quelqu'un (« RDV M. Untel »), et le registre dit que Telegram, hors UE, ne reçoit **aucune donnée de tiers** (décidé le 09/10).

## Décision

1. **Le serveur de la page lit l'agenda, à la demande.** Il écoute sur `127.0.0.1` seulement : tant que la page reste sur le Mac (ADR-0006), l'agenda n'en sort pas. Une route `/api/agenda`, ajoutée aux routes gardées par mon jeton (un test le vérifie), lit chaque compte déclaré **au moment de l'appel** et rend les rendez-vous de la fenêtre. Rien n'est écrit : ni en base, ni au journal, ni dans un fichier, ni dans un cache. La réponse vit le temps de la requête.

2. **Ce qui est demandé, ce qui est gardé.** La requête ne demande au serveur que l'intitulé (`SUMMARY`), le début, la fin ou la durée, et la règle de récurrence (pour reconnaître une série non étendue) — l'extraction partielle de CalDAV (RFC 4791, § 9.6). Un serveur qui renverrait l'événement entier n'y change rien : tout autre champ — invités, organisateur, lieu, description, pièces — est **ignoré à la lecture**, jamais rendu, jamais journalisé (charte, règle 6). Que mes deux serveurs honorent l'extraction partielle avec l'extension des séries se vérifie en P1, contre eux. L'intitulé est du texte écrit par d'autres : borné à 200 caractères, caractères de contrôle ôtés, rendu comme du texte, jamais interprété, jamais donné à un modèle.

3. **Le client CalDAV ne sait que lire** : `PROPFIND` et `REPORT`, rien d'autre ; une épreuve vérifie, **en lisant le code**, qu'aucune autre méthode n'y figure.
   - **HTTPS obligatoire**, vérification du certificat jamais désactivée ; aucune redirection suivie (une redirection est une panne, dite) ; 8 Mio au plus par réponse, 30 s au plus par requête, et un **délai global par compte** ; les comptes sont lus en parallèle.
   - **Les hôtes admis** : l'hôte déclaré, et ceux que je liste **nommément** pour ce compte dans `agenda.local.toml` (iCloud annonce ses agendas sur un autre hôte que celui qu'on joint). Ni joker, ni « voisinage » calculé : la règle de Legion admettait `co.uk` sous `exemple.co.uk`, et sur un hébergeur, les sous-domaines de ses autres clients. Le contrôle se fait **au moment d'envoyer**, sur l'adresse résolue (une adresse reçue en `//autre-hote/…` sort de l'origine) : le mot de passe ne part jamais vers un hôte non admis (charte, règles 2 et 5).
   - **Le XML est lu par un analyseur choisi en P1** (une dépendance nouvelle, soumise à mon accord) : aucune DTD ni entité acceptée, où qu'elle soit dans la réponse — elle est refusée, jamais développée.

4. **Les dates.**
   - La fenêtre se compte en **jours civils de Paris** (`Europe/Paris`) : de minuit à minuit, chaque jour calculé dans le fuseau, de sorte qu'un changement d'heure ne la fait finir ni à 23 h ni à 1 h. 7 jours par défaut, 31 au plus.
   - Une heure en UTC ou dans un fuseau connu (`TZID` de la base IANA) est convertie ; une heure qui n'existe pas ou existe deux fois dans son fuseau (le changement d'heure) suit la règle de la RFC 5545 (§ 3.3.5) ; un fuseau inconnu (un nom Windows, par exemple), une heure sans fuseau, une série non étendue sont **écartés, avec un motif tiré d'une liste fermée** — jamais un extrait de l'événement. Les motifs sont rendus à la page : un agenda montré plus vide qu'il n'est vaut moins que pas d'agenda.
   - Une journée entière reste sa date, sans conversion.

5. **Les comptes et leurs secrets.**
   - Les comptes se déclarent dans `agenda.local.toml` (ignoré par git) : un nom que je choisis, l'adresse du serveur, l'identifiant, les hôtes admis en plus, les calendriers à ne pas lire. Un compte non déclaré n'est pas lu. Deux déclarations d'un même compte — même hôte, même identifiant, quel que soit leur nom — sont refusées : ses rendez-vous viendraient en double sans que rien ne le dise.
   - Les calendriers se retirent **par leur nom affiché** : c'est une liste de refus, qui s'ouvre si je renomme un calendrier. Le prix est dit ; l'autre voie (nommer ceux qu'on lit) ferait cesser la lecture au premier renommage, et Legion l'a écartée pour cela. Tant que Legion écrit ses rappels dans un calendrier à lui, celui-ci est retiré.
   - Les **mots de passe d'application** vivent dans `.env.agenda`, une famille de secrets à part, chargée par **le serveur de la page seul** (`run.sh` et `npm run server`), comme `.env.proxmox` (ADR-0039). Leurs noms portent le nom du compte (`CENACLE_AGENDA_MOT_DE_PASSE_<COMPTE>`) : la famille est donc reconnue **par préfixe**, et `secrets.ts` l'apprend, pour qu'un autre programme qui la trouverait dans son environnement refuse de démarrer.
   - Le journal du serveur ne dit d'une lecture que le nom du compte et un mot fixe : `refus` (le serveur refuse le mot de passe : 401, 403), `injoignable`, `delai`, `illisible`, `hote` (une adresse hors des hôtes admis). Jamais un intitulé, une heure, un identifiant, une adresse ni un message du serveur. (Chez Legion, « refus » désignait la conciergerie ; ici, c'est le serveur de l'agenda.)

6. **Sur la page, un onglet « Agenda ».** Les rendez-vous jour par jour, avec leur intitulé ; un compte en panne nommé, avec le mot qui dit sa panne, les autres affichés ; les écartés et leur motif. Lu à l'ouverture de l'onglet, puis toutes les 15 minutes tant qu'il est ouvert.

7. **Sur Telegram, des heures et jamais d'intitulé** (palier P2). `/demain` (et `/agenda` pour la semaine) répond par le nombre de rendez-vous et leurs heures : « Demain : 3 rendez-vous — 09:00, 14:30, 17:00 (et 1 journée entière) ». Le bot ne détient pas les mots de passe : il demande les heures au serveur de la page par une **prise locale que seul mon compte peut ouvrir** (droits `600`, comme celle du CTO, ADR-0020). C'est une exposition nouvelle — le serveur qui détient les mots de passe écoute, et tout programme lancé sous mon compte pourrait déclencher une lecture — d'où ses bornes : **une lecture à la fois**, une réponse au **schéma fermé** (des nombres et des heures `HH:MM`, des noms de compte et des mots de panne), qui ne peut pas porter un intitulé faute de lui être donné.

8. **Aucune IA.** Ni la lecture, ni l'affichage, ni `/demain` ne passent par un modèle. Rien à inscrire au registre de l'IA.

9. **Tests adversariaux exigés** :
   - le client ne contient aucune méthode d'écriture (épreuve sur le code) ;
   - une adresse hors des hôtes admis (y compris `//autre-hote/…`, une adresse IP voisine, un hôte qui ne partage que son suffixe), une redirection, du HTTP en clair, une réponse trop grande ou trop lente sont refusées, et le mot de passe n'est jamais envoyé ailleurs qu'à un hôte admis ;
   - une DTD ou une entité, n'importe où dans la réponse, est refusée ;
   - une heure sans fuseau, un fuseau inconnu, une série non étendue sont écartés avec un motif de la liste, sans extrait ; une journée entière reste sa date ; la fenêtre et les heures ne bougent pas autour des changements d'heure, et une heure inexistante ou double suit la RFC 5545 ;
   - un compte en panne n'efface pas les autres ; un refus et une panne sont dits différemment ; deux déclarations du même compte sous deux noms sont refusées ;
   - aucun champ autre que l'intitulé et les heures n'est rendu, même présent dans l'événement ;
   - rien n'est écrit en base, au journal ni sur le disque après une lecture ;
   - la route exige mon jeton ; la prise de `/demain` ne rend jamais un intitulé, sert une lecture à la fois, et refuse une requête hors schéma ;
   - un programme autre que le serveur de la page refuse de démarrer avec un secret de la famille `agenda`.

## Paliers

- **P0** — cet ADR, pour relecture.
- **P1** — le client CalDAV en lecture seule et le lecteur de l'agenda, la route `/api/agenda`, l'onglet de la page ; la famille de secrets `agenda` reconnue par préfixe ; le registre (T-11, et les fournisseurs d'agenda parmi les services tiers) ; la marche à suivre dans `docs/securite/secrets.md`. L'analyseur XML est proposé à mon accord avant d'être ajouté.
- **P1, par moi** — un mot de passe d'application par compte, `agenda.local.toml` et `.env.agenda`, puis le redémarrage du serveur de la page ; une première lecture contre mes vrais serveurs, qui vérifie l'extraction partielle et l'extension des séries.
- **P2** — `/demain` et `/agenda` sur Telegram, par la prise locale.

## Conséquences

- **Un traitement de plus** (T-11), sans conservation : des intitulés et des heures, lus à la demande, tenus en mémoire le temps d'une requête, montrés à moi seul sur le Mac.
- **Sa base légale reste à trancher par moi.** Le responsable du registre est l'EURL, pour l'usage professionnel de son dirigeant : l'agenda professionnel y entre (intérêt légitime : organiser mon travail) ; **mon agenda personnel en sort**. Avant P1, je décide : ne déclarer que le compte professionnel, ou inscrire le personnel au registre en le disant.
- **Des tiers, déjà là** : les fournisseurs de mes agendas (Apple pour le compte personnel, l'hébergeur du compte professionnel). Comme Legion, je considère qu'on n'ajoute pas de sous-traitant — mes agendas y vivent indépendamment de Cénacle, qui ne leur envoie que ses requêtes de lecture. **L'hébergement hors UE d'un fournisseur reste à trancher par moi**, et le registre le dira.
- Les hôtes des agendas viennent de `agenda.local.toml`, pas du code : le contrôle de conformité, qui relève les hôtes écrits dans le code, ne les voit pas. Le registre les nomme en termes génériques.
- **Le serveur de la page détient un secret de plus** — il détenait déjà le mot de passe de la boîte, la clé de la page et le jeton Proxmox (ADR-0039) — et contacte les hôtes de mes agendas. En P2, il écoute en plus sur une prise locale.
- Un agenda ne se lit que si le Mac est éveillé et le serveur en marche ; un agenda injoignable se voit, il ne se tait pas.
- **Ce que ça ne fait pas** : écrire dans un agenda ; dire qu'un rendez-vous a été déplacé (il faudrait garder quelque chose — un autre traitement, un autre ADR) ; lire les invités.

## Options écartées

- **Garder les rendez-vous en base, comme une source** (le Regard de Legion, ou les mails d'Iris) : permettrait de dire « déplacé » ou « annulé », mais recopie des données de tiers pour les afficher une seconde fois — conservation, purge, droits des personnes. Legion l'a écartée pour la même raison.
- **Les intitulés sur Telegram** : plus commode loin du Mac, mais contraire à la règle des tiers ; possible plus tard par un ADR qui la révise.
- **Le bot détient les mots de passe et lit lui-même** : deux programmes au lieu d'un détiendraient le secret, et le bot pourrait rendre un intitulé.
- **Le voisinage de Legion** (l'hôte privé de son premier label) : commode pour iCloud, mais trop large ailleurs ; remplacé par une liste nommée par compte.
- **Lire l'agenda du Mac (l'app Calendrier) plutôt que les serveurs** : aucun mot de passe à détenir, mais il faudrait un programme natif et une autorisation macOS fragile pour un service lancé par `launchd`, et l'agenda ne serait à jour que si l'app synchronise. À reconsidérer si la détention des mots de passe posait problème.
- **Garder l'agenda de Legion** : l'objet même de la décision du 10/10.
