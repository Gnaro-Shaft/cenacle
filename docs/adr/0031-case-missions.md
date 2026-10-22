# ADR-0031 — La case « Missions » : les alertes des plateformes, par l'adresse exacte de l'expéditeur

**Statut** : proposée (2026-10-22) — complète l'ADR-0007 (une cinquième case) et l'ADR-0029 (une étape avant le courrier de masse) ; garde l'ADR-0014 ; prépare l'ADR-0032

## Contexte

Je veux une veille de missions freelance qui tourne seule : elle trouve les missions, les trie, me prévient et suit ma prospection (ADR-0032). Sa matière, ce sont les **alertes e-mail des plateformes** (réseau professionnel, places de marché freelance, sites d'offres). Récupérer les posts du réseau professionnel par programme est exclu : c'est interdit par ses conditions d'utilisation, et ces posts contiennent des données de personnes.

Ces alertes arrivent aujourd'hui dans ma boîte pro, qu'Iris relève déjà. Mais elles sont envoyées en nombre : elles portent `List-Unsubscribe`, et l'ADR-0029 les range en « Bruit ». Mes règles réelles mettent d'ailleurs ces plateformes en « Bruit » : elles m'envoient aussi leur publicité et leurs notifications, **depuis le même domaine**.

Aucune des quatre cases ne convient :

- **« Bruit »** : il faudrait que l'agent lise toute ma publicité pour y trouver les missions ;
- **« Clients et prospects »** : une alerte de plateforme y déclencherait une relance à 48 h et un brouillon de réponse à une adresse qui ne lit pas ses mails ;
- **« Administratif »** : ce n'en est pas.

## Décision

1. **Une cinquième case, « Missions »**, pour les alertes de missions des plateformes. Elle ne donne lieu ni à une relance, ni à un brouillon, ni à une alerte urgente : ces trois mécanismes restent propres à « Clients et prospects » (ADR-0007). Sa seule suite est l'agent prospection (ADR-0032).
2. **Seule une règle y range un mail, jamais le modèle.**
   - Une section `[missions]` de `regles.local.toml` liste des **adresses exactes d'expéditeur** (clé `adresses`), et non des domaines. Une plateforme envoie ses alertes et sa publicité depuis le même domaine : une règle par domaine rangerait sa publicité en « Missions », alors que je la range en « Bruit ».
   - La comparaison est exacte, sans joker, sans casse. La partie domaine suit la même règle que l'ADR-0007.
   - Les règles ne connaissent aujourd'hui que des domaines : le tri reçoit désormais aussi l'adresse de l'expéditeur, **en mémoire, le temps de la relève**.
3. **Le domaine doit être authentifié par notre serveur** (ADR-0014). Sinon, la règle `[missions]` **ne s'applique pas** et le tri continue comme si elle n'existait pas : un faux mail « de » l'adresse d'alerte, envoyé en nombre, reste en « Bruit » (ADR-0029). Il ne monte pas en « À trier », où je le lirais.

   **Limite assumée** : l'authentification prouve le domaine, pas l'adresse entière (DMARC, DKIM). Je me fie à la plateforme pour que personne d'autre n'écrive depuis son adresse d'alerte. Un texte qu'un tiers ferait passer par elle reste une donnée, jamais une consigne (ADR-0032).
4. **L'ordre du tri** :
   - un expéditeur illisible reste « À trier » ;
   - **une règle `[missions]` décide ensuite**, avant toute autre étape, y compris le plafond de l'ADR-0030. Elle est plus précise qu'une règle par domaine, et une alerte de plateforme est du courrier de masse par nature ;
   - sinon, rien ne change (ADR-0029, ADR-0030) : le plafond, la règle « Clients et prospects », le courrier de masse, la règle du domaine, puis le modèle.
5. **Le modèle ne connaît pas cette case.** Deux listes distinctes dans le code :
   - **les cases de la base**, au nombre de cinq ;
   - **les réponses permises au modèle**, au nombre de quatre et inchangées. Sa réponse est lue contre ces quatre-là. Un « missions » écrit par le modèle n'est pas une réponse valide : il donne « À trier », comme toute réponse hors liste.

   Un mail hors règle qui parle d'une mission reste jugé comme aujourd'hui : un client qui m'écrit lui-même pour une mission reste un client, avec sa relance et son brouillon.
6. **Rien n'est gardé de plus** (ADR-0012) :
   - l'adresse de l'expéditeur sert au tri, puis elle est oubliée. Elle n'est gardée que sous forme de clé, comme toute adresse ;
   - `decided_by` vaut `rule`, comme pour toute règle ;
   - mes adresses de plateformes restent dans `regles.local.toml`, ignoré par git. L'exemple versionné n'utilise que des domaines fictifs.
7. **Ce qui est déjà rangé ne bouge pas** : la règle vaut pour les mails reçus après elle (comme l'ADR-0029).

## Conséquences

- **La base** : la liste des cases est une contrainte écrite dans la table (`002_mail_items.sql`), sans nom, qu'aucune migration n'a encore refaite.
  - La migration 026 la remplace, sans revalider les lignes anciennes (`NOT VALID`).
  - Elle ajoute une contrainte : **« Missions » n'est décidé que par une règle** (`decided_by = 'rule'`), comme `masse` ne mène qu'à « Bruit » (migration 025).
- **Les anciens événements** : `mail.sorted_by_rules` et `mail.totals`, gardés 180 jours, n'ont pas de clé `missions`. Leur lecture la tient pour zéro, comme elle le fait déjà pour une clé ajoutée après coup, au lieu de rendre Iris « malade ».
- **Partout où les cases sont listées**, la cinquième s'ajoute :
  - la page, `/etat` et le récapitulatif de 9 h, 13 h et 18 h ;
  - la ligne de commande, la mesure et la revue (une lettre de plus) ;
  - le banc ;
  - le jeu de mails fictifs : les alertes de `plateforme-freelance.example` et l'alerte d'offres du réseau fictif passent en « Missions » par une règle sur leur adresse ; les messages de clients de la plateforme, envoyés d'une autre adresse, restent « Clients et prospects ». Le jeu reste entièrement authentifié par le serveur fictif : la fausse alerte, pour chaque verdict d'authentification, est éprouvée par les tests adversariaux de la règle (`missions-rule.adversarial.test.ts`).
- **Le droit avant la technique** (ADR-0009) : la mention d'information (`docs/conformite/mention-information.md`) et la ligne T-01 du registre listent les cases. Elles sont mises à jour **avant** que la case n'entre en service sur la vraie boîte.
- **La mesure M2** passe à des tableaux 5 × 5. Une publicité envoyée depuis une adresse d'alerte se retrouvera en « Missions » : l'agent n'y trouvera aucune annonce et le comptera (ADR-0032). La mesure dira si c'est fréquent.
- **Une liste d'adresses est à tenir à la main**, mais elle est courte : une ou deux adresses par plateforme.

## Options écartées

- **Une règle par domaine** : la publicité de la plateforme irait en « Missions » (point 2).
- **Laisser le modèle ranger en « Missions »** : il se trompe déjà avec assurance. Et un inconnu qui écrit « mission » ferait entrer son texte dans mon tableau.
- **Un faux expéditeur en « À trier »**, comme pour une règle client (ADR-0014) : ce serait faire monter vers ma lecture un mail que le courrier de masse mettait en « Bruit ».
- **Laisser les alertes en « Bruit » et y faire lire l'agent** : il lirait toute ma publicité, contre la minimisation.
- **Les ranger en « Clients et prospects », sans suivi** : la case garderait son alerte urgente et son sens de « quelqu'un attend ma réponse », que les mesures et le suivi (phase 3) supposent.
- **Reconnaître les alertes à leur objet** (« nouvelles missions », « offres pour vous ») : l'objet est écrit par l'expéditeur et ne prouve rien, au contraire d'un domaine authentifié.
