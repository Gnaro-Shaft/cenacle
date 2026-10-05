# ADR-0015 — Ouvrir la vraie boîte aux brouillons et aux envois, en deux crans datés

**Statut** : acceptée (2026-10-05) — complète l'ADR-0004, l'ADR-0009 et l'ADR-0013

## Contexte

En M2, la boîte pro est lue en lecture seule : le code interdit tout brouillon et tout envoi sur une vraie boîte non marquée `test = true`. M3 doit lever ce verrou : Iris rédige sur la vraie boîte, et les réponses que j'accepte partent chez de vrais correspondants.

Trois risques changent de nature avec de vrais destinataires :

1. **Un envoi ne se rattrape pas.** Une réponse partie est partie.
2. **Un expéditeur usurpé.** Rien ne vérifie encore DKIM, SPF ou DMARC. Un mail falsifié au nom d'un client recevrait un brouillon fait de son propre fil ; une acceptation trop rapide l'enverrait au vrai client, en réponse à un faux message.
3. **Un volume.** Une erreur de code ou d'acceptation peut se répéter.

Deux conditions fixées le 05/10 doivent être remplies avant d'ouvrir : les mesures de M2 publiées, et la règle de confiance de l'authentification des expéditeurs (ADR-0014, à venir).

## Décision

1. **Deux crans, datés par ma décision**, dans `cadre.local.toml` :
   ```toml
   [ouverture]
   brouillons = 2026-MM-JJ   # T-03 : Iris rédige ; les envois ne vont qu'à ma liste fermée
   envoi = 2026-MM-JJ        # T-04 : les réponses acceptées vont au vrai correspondant
   ```
   - Sans `[ouverture]`, la boîte reste en lecture seule (M2). **Aucune autre clé ne l'ouvre.**
   - Une date non atteinte, `envoi` sans `brouillons`, ou `envoi` daté avant `brouillons` : Cénacle refuse de démarrer.
   - `[ouverture]` n'a pas de sens pour la boîte fictive ni pour une vraie boîte de test (déjà ouvertes) : refusée.
   - Le premier cran me montre de vrais brouillons sur mon vrai courrier sans que rien ne parte chez un correspondant.
2. **Le vrai correspondant, et lui seul.** Une fois `envoi` ouvert, une réponse ne va qu'à l'expéditeur du mail, relu sur le serveur au moment de l'envoi, une seule adresse simple (inchangé depuis la phase 4). Avant, elle ne va qu'à ma liste fermée (`[envoi] destinataires`).
3. **Pas de brouillon pour un expéditeur non authentifié.** Sur une vraie boîte, Iris demande avant tout vote du modèle si l'expéditeur est authentifié ; l'exécuteur le redemande avant d'envoyer, et laisse sinon la proposition devenir caduque. **Tant que la règle de confiance (ADR-0014) n'existe pas, la réponse est non** : une boîte ouverte aux brouillons n'en reçoit aucun. Le mail est présenté « à toi de répondre ». La boîte fictive et les vraies boîtes de test ne le demandent pas : leurs mails sont fictifs ou les miens.
4. **Des limites propres à la vraie boîte** :
   - **5 envois par jour** par défaut (`[envoi] max_par_jour`, de 1 à 20), au lieu de 20 ;
   - **10 minutes pour changer d'avis** après une acceptation, au lieu de 2. Le serveur de la page fixe le délai ; l'exécuteur le revérifie lui-même. La base garde son plancher de 2 minutes, pour toutes les boîtes, car elle ne sait pas de quelle boîte vient une proposition.
5. **Chaque programme vérifie lui-même** ce que la boîte lui permet (`refuseDrafts`, `refuseSending`) : la rédaction, l'envoi, la copie dans les Envoyés. L'exécuteur refuse de démarrer sur une boîte qui n'envoie rien.
6. **La page dit où partira la réponse** : « Destinataire réel » en rouge une fois `envoi` ouvert, « Envoi limité à ta liste fermée » avant.

## Conséquences

- L'ouverture est un acte écrit, daté, relu : elle ne peut pas venir d'une valeur par défaut, d'une faute de frappe ni d'une clé oubliée.
- Le code de M3 peut être livré et éprouvé avant d'ouvrir : sans `[ouverture]`, rien ne change pour la boîte pro.
- Tant que l'ADR-0014 n'est pas en place, M3 ne peut pas produire de brouillon sur la vraie boîte, même ouverte : c'est voulu.
- 10 minutes de délai rendent l'envoi un peu plus lent ; c'est le prix d'une réponse qu'on ne rattrape pas.

## Options écartées

- **Une seule clé d'ouverture** : je ne verrais jamais de vrais brouillons sans risque d'envoi.
- **Un booléen `ouvert = true`** : sans date, rien ne relie l'ouverture à une décision consignée au registre.
- **Exiger l'authentification plus tard** : un expéditeur usurpé recevrait un brouillon fait de son fil dès le premier jour.
- **Porter le plancher de la base à 10 minutes pour toutes les boîtes** : ralentirait la boîte de test sans rien protéger de plus ; la base ne distingue pas les boîtes.
