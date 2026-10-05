# ADR-0014 — Un « client » doit être authentifié par notre propre serveur

**Statut** : acceptée (2026-10-05) — complète l'ADR-0007, à tenir avant M3

## Contexte

Le classement par règles (ADR-0007) range un mail d'après le **domaine exact de son `From`**. Or le `From` est écrit par l'expéditeur : rien n'empêche un inconnu d'envoyer un mail « de » `client.example`. Constaté le 05/10 : `regles.example.toml` annonçait qu'une règle `clients_prospects` ne vaudrait que pour un expéditeur authentifié, mais **aucun code ne le faisait**. Un `From` falsifié au domaine d'un client était donc :

- rangé « Clients & prospects » ;
- suivi (relance après 48 h ouvrées) ;
- capable de déclencher une **alerte urgente** (terme d'urgence dans l'objet).

En M2 (lecture seule), l'impact reste limité. En M3, « client » voudra dire « Iris propose une réponse » : il faut le régler avant.

Le serveur qui reçoit le courrier vérifie SPF, DKIM et DMARC, et écrit son verdict dans un en-tête `Authentication-Results` (RFC 8601). Mais **n'importe qui peut écrire cet en-tête** dans le mail qu'il envoie, y compris au nom de notre serveur. La question est donc : quel en-tête croire ?

## Mesure (étape 0, 05/10)

`npm run mail:auth-survey` lit, en lecture seule, les en-têtes d'authentification des mails reçus depuis la mention d'information, et n'affiche que des compteurs : aucun nom de serveur, domaine ou adresse (les serveurs sortent en lettres A, B…).

Sur la vraie boîte, 5 mails que je me suis envoyés, dont un depuis Outlook :

- **5 sur 5** portent un `Authentication-Results` d'un même serveur (A), **une seule fois** ;
- il est toujours **le premier** `Authentication-Results` du mail ;
- il a toujours **exactement 5 `Received` au-dessus de lui** (sur 7) : le serveur l'écrit à l'entrée, puis ajoute ses étapes internes par-dessus ;
- dmarc, dkim et spf y sont à `pass`, alignés sur le domaine du `From` ;
- les `ARC-Authentication-Results` viennent des fournisseurs des expéditeurs (2 mails sur 5), pas de notre serveur.

A est présumé être notre serveur de réception : à confirmer avec `--serveur=<nom>` avant de remplir `authserv_id`.

Conséquence : la règle d'abord envisagée (« croire l'en-tête situé au-dessus de tous les `Received` ») aurait tout refusé. La position de l'en-tête est stable : elle devient le critère.

## Décision

1. **Un seul en-tête est cru** : un `Authentication-Results` dont :
   - le nom de serveur est **exactement** `authserv_id` ;
   - **exactement** `rang_attendu` en-têtes `Received` sont au-dessus de lui ;
   - c'est le **seul** du mail à porter ce nom de serveur. Un second (écrit par l'expéditeur, au-dessus ou en dessous) est une injection : alors **aucun** n'est cru.

   `authserv_id` et `rang_attendu` sont dans `[mail]` de `cadre.local.toml`, **obligatoires** : sans eux, Cénacle refuse de démarrer (refus par défaut). Le nom réel n'est jamais dans le dépôt.
2. **« Authentifié »** veut dire, dans cet en-tête :
   - `dmarc=pass` avec `header.from` égal **exactement** au domaine du `From` ; plusieurs résultats DMARC doivent tous le dire ;
   - sinon, si le domaine ne publie pas de politique DMARC (résultat absent ou `none`) : `dkim=pass` avec `header.d` égal **exactement** à ce domaine ;
   - **jamais SPF seul** : il garantit l'enveloppe, pas le `From` que l'on lit.

   Un sous-domaine ou un domaine parent ne compte pas (même règle que le classement : pas de joker). Tout le reste donne « non authentifié », avec une raison comptée : `missing`, `duplicated`, `misplaced`, `unreadable`, `failed`.
3. **Une règle `clients_prospects` ne s'applique qu'à un expéditeur authentifié.** Sinon le mail va dans **« À trier »**, décidé par `unauthenticated`, **sans passer par le modèle** : un faux mail « client » saurait convaincre le modèle qu'il en est un. Les autres règles (administratif, bruit) s'appliquent comme avant.
4. **Ni suivi ni alerte sans authentification.** L'authentification est retenue par mail (`sender_authenticated`, oui/non, purgé avec la ligne). Un mail n'est relancé (T-02) et ne déclenche d'alerte urgente que si son expéditeur est authentifié, **même rangé « client » par le modèle**.
5. **Journal** : à chaque relève avec de nouveaux mails, `mail.sender_auth` donne des **compteurs seulement** (`mails`, `trusted`, et un compteur par verdict), jamais d'adresse, de domaine ni d'UID.
6. **Perdre la preuve se voit.** Si une relève avec de nouveaux mails ne trouve l'en-tête de notre serveur, à sa place et seul, dans **aucun** d'eux (changement chez l'hébergeur, rang déplacé), Iris s'affiche **malade** (`auth_missing`) jusqu'à la relève qui le retrouve. Des mails falsifiés seuls (`failed`) ne la rendent pas malade : l'en-tête est là, c'est le contrôle qui échoue.

## Conséquences

- Si l'hébergeur change son circuit, tous les « clients » tombent en « À trier » et Iris s'affiche malade : on relance `npm run mail:auth-survey -- --serveur=<nom>` et on corrige `rang_attendu`. Échouer du côté sûr est voulu.
- Un vrai client dont le domaine n'a **ni DMARC ni DKIM** arrivera en « À trier ». À mesurer à l'usage (compteurs `failed`) avant d'envisager autre chose ; ne pas affaiblir la règle à l'aveugle.
- Les mails mémorisés avant cette décision sont réputés **non authentifiés** (valeur par défaut protectrice) : ils ne sont plus relancés ni alertés.
- La boîte fictive suit la même règle : ses mails portent l'en-tête d'un serveur fictif (`mx.cenacle.test`, rang 0).

## Hors périmètre

- Exiger l'authentification pour les règles administratif et bruit (un faux mail « de la banque » reste rangé administratif, sans alerte).
- Vérifier DKIM nous-mêmes (mail complet et DNS).
- Croire les en-têtes ARC des intermédiaires.

## Vérification

- `sender-auth.adversarial.test.ts` : `From` falsifié, en-tête absent, en-tête injecté au-dessus ou en dessous du nôtre, en double, mal placé, tronqué, illisible, résultats contradictoires, domaine parent ou sous-domaine, SPF seul.
- `collect-auth.adversarial.test.ts` : un faux client va en « À trier », jamais au modèle, ni relancé ni alerté ; le journal ne contient que des compteurs ; Iris malade puis guérie.
- Base (`mail-store.adversarial.test.ts`) : alerte réservée aux expéditeurs authentifiés, `unauthenticated` toujours en « À trier », valeur par défaut `false`.
- GreenMail (`postman.integration.test.ts`) : les 147 mails fictifs sont authentifiés par la vraie lecture IMAP ; un autre nom de serveur ou un autre rang n'authentifie personne.
