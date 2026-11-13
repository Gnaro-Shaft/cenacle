# AIPD légère — Cénacle (2026-10-04)

> Analyse d'impact relative à la protection des données (RGPD art. 35), forme
> allégée, décidée le 2026-10-04 après l'examen `aipd-examen.md` (2 critères sur
> 9). Structure de la méthode PIA de la CNIL : contexte, principes
> fondamentaux, risques, plan d'action, validation. **Rédigée par Claude, à
> valider par le responsable de traitement** ; ce n'est pas un avis juridique.
> Fait vérifié le jour même : FileVault actif sur le Mac.

## 1. Contexte

**Responsable** : Gnaro (EURL), pour l'usage professionnel de son dirigeant.
**Machines** : le Mac seul : programmes, base PostgreSQL et services liés à `127.0.0.1`, et le modèle local, sur le même Mac : servi par Ollama, à l'écoute du Mac seul, sans son cloud, depuis le 2026-10-21 (ADR-0028) ; le code n'accepte plus d'autre adresse que cette machine depuis le 2026-11-13. La boîte reste chez OVH (France).

**Traitements couverts** (détail : `registre-traitements.md`) : T-01 relève et rangement, T-02 suivi et alertes, T-03 brouillons, T-04 envois acceptés, T-05 journal, T-06 traces sans contenu ; T-07 (liste d'opposition) et T-08 (boîte de test) en découlent ; T-09 (veille des missions) a son ajout du 2026-10-22, plus bas.

**Personnes concernées** : les correspondants de la boîte pro (clients, prospects, administrations, expéditeurs de lettres d'information), et les personnes citées dans leurs mails.

**Cycle de vie** : un mail est relu sur le serveur, en lecture seule → son objet et son texte sont donnés au modèle local, en mémoire, le temps d'un appel → seuls l'UID, la date, la case et des clés HMAC sont gardés (90 jours) → un brouillon peut être proposé (texte effacé 7 jours après la clôture) → s'il est accepté sur la page, l'exécuteur l'envoie, et la copie va dans mes Envoyés.

## 2. Principes fondamentaux

| Principe | Mise en œuvre | Suffisant ? |
|---|---|---|
| Finalités déterminées | Une par traitement, au registre ; une source n'est lue que déclarée, par le cadre exécutable (`cadre.toml`, C1) | Oui |
| Base légale | Intérêt légitime, validé le 2026-10-04 pour T-01 à T-06 | Oui |
| Minimisation | Ni objet ni corps stockés ; clés HMAC au lieu des adresses ; le modèle ne voit qu'un mail à la fois | Oui |
| Exactitude | Vérificateur de faits sans IA ; cases douteuses laissées vides et visibles ; relecture humaine de chaque brouillon | Oui, avec les limites du registre IA |
| Durées | 90 jours (mémoire), 7 jours (texte des brouillons), 7 jours (traces) ; propositions et journal purgés selon le cadre, et la base refuse une purge plus récente que la durée de conservation (lot A3, 2026-11-13 : planchers 180 et 90 jours) | Oui |
| Information | Mention publique sur le site, paragraphe « Mon assistant de messagerie » (C4), republiée le 2026-10-22 pour les alertes de missions ; à republier après le 2026-11-13 (lot D : ce que le code garantit pour les noms de personne) | Oui, sous réserve de la republication |
| Accès, rectification, effacement | `npm run personne` : export JSON, effacement, liste d'opposition qui le fait tenir (C3) | Oui |
| Opposition, limitation | Liste d'opposition : les mails de la personne ne sont plus lus ; couper la source. La clé y reste 3 ans après sa dernière trace (demande ou dernier mail rencontré), le temps que ses mails peuvent rester dans ma boîte (2026-10-10) | Oui |

## 3. Risques

Échelle CNIL : négligeable, limitée, importante, maximale. Évalués **après** les mesures déjà en place et celles prévues **avant l'ouverture** (C1 à C4, S1, S2).

### R1 — Accès illégitime aux données

- **Impacts** : divulgation du contenu de brouillons (propos de correspondants), de la liste des mails en attente ; usage du mot de passe de la boîte.
- **Sources** : vol ou compromission du Mac ; programme compromis sur le Mac ; fuite d'un secret.
- **Mesures** : FileVault ; programmes, base et services liés à `127.0.0.1` ; page protégée par un jeton tiré à chaque démarrage, origine et nom d'hôte vérifiés ; rôles séparés en base, signatures de la page (ADR-0013) ; aucun contenu dans le journal, les traces ni Telegram.
- **Faiblesses** : un seul compte macOS (ADR-0013). Corrigé en S1 : chaque programme ne charge que ses secrets et refuse ceux des autres (en particulier le mot de passe du propriétaire de la base, que tous recevaient jusque-là) ; secrets sauvegardés chiffrés.
- **Gravité : importante. Vraisemblance : limitée.**

### R2 — Modification non désirée : une réponse erronée part chez un tiers

- **Impacts** : un correspondant reçoit un fait inventé, une réponse qui ne lui était pas destinée, ou un texte qu'il n'aurait pas dû recevoir.
- **Mesures** : aucun envoi sans mon acceptation **signée** par la page ; destinataire relu sur le serveur (l'expéditeur, jamais un Reply-To) ; délai d'annulation de 10 minutes sur la vraie boîte (2 sur une boîte de test) ; plafond de 5 envois par jour (ADR-0015) ; vérificateur de faits ; banc : 0 envoi sans acceptation, 0 fait inventé ; envois limités aux domaines de test jusqu'à M3.
- **Gravité : limitée** (je relis chaque texte). **Vraisemblance : limitée.**

### R3 — Injection par un mail

- **Impacts** : un mail piégé tenterait de faire agir Iris, ou de faire sortir des données.
- **Mesures** : le modèle n'a aucun outil et Iris ne lui ouvre aucun accès ; un mail n'est qu'une donnée (ADR-0005) ; il ne peut ni accepter ni envoyer ; banc : 11 pièges, 0 envoi.
- **Gravité : importante. Vraisemblance : négligeable.**

### R4 — Données sensibles lues par le modèle

- **Impacts** : une donnée de l'article 9 (santé, opinions…) contenue dans un mail est lue par le modèle local.
- **Mesures** : traitement local, rien n'est stocké du contenu ; **plancher déterministe** (C2, fait le 2026-10-04) : un mail qui semble révéler une catégorie particulière n'est jamais donné au modèle, et le modèle refuse lui-même un tel mail ; la raison d'un écartement n'est jamais conservée. Banc : 18 sur 18 écartés. Limite : liste non exhaustive.
- **Gravité : importante. Vraisemblance : limitée.**

### R5 — Disparition des données

- **Impacts** : perte de la mémoire des mails (elle se relit) ou de l'historique des propositions.
- **Gravité : négligeable. Vraisemblance : limitée.**

## 4. Plan d'action

| # | Action | Risque | Jalon |
|---|---|---|---|
| 1 | ~~Cadre exécutable, et durées et purges pour toutes les tables (propositions, journal)~~ **fait avant l'ouverture du 2026-10-05** ; planchers de purge tenus par la base le 2026-11-13 | Durées | C1 |
| 2 | ~~Plancher article 9, déterministe, avant le modèle~~ **fait le 2026-10-04** | R4 | C2 |
| 3 | ~~Export et effacement par adresse~~ **fait le 2026-10-04** | Droits | C3 |
| 4 | ~~Mention révisée et publiée, vérifiée en ligne~~ **fait avant l'ouverture du 2026-10-05**, republiée le 2026-10-22 ; à republier après le lot D | Information | C4 |
| 5 | ~~Un fichier d'environnement par programme ; sauvegarde chiffrée des secrets~~ **fait le 2026-10-04** ; reste la liste d'opposition à protéger d'une perte de la base | R1 | S1 |
| 6 | ~~Sentinelle sans contenu (ADR-0002)~~ **en service depuis le 2026-10-05** | Disponibilité | S2 |
| 7 | Revoir cette AIPD avant M3 (premiers envois réels), puis au plus tard le 2027-10-04 | Tous | — |

## Ajout du 2026-10-22 — la veille des missions (T-09, IA-08)

La veille des missions (ADR-0031, ADR-0032) **ne demande pas d'AIPD propre**, décidé par le responsable le 2026-10-22 : ni profilage à grande échelle, ni donnée sensible (le plancher article 9 écarte avant le modèle toute alerte qui en semble porteuse), ni surveillance systématique, ni décision ayant un effet sur une personne. Elle ne lit que les alertes des plateformes auxquelles je suis abonné, ne garde que des champs fermés de mission (jamais un nom ni une adresse de personne), 60 jours, sur le Mac. Classement IA : risque minimal (IA-08). Les risques R1 (accès), R3 (injection) et R5 (perte) s'y appliquent comme au reste ; R3 est tenu par les marqueurs, la sortie validée par schéma et les liens remplacés par des numéros.

## Revue du 2026-11-13 (audit, lot D)

Faits remis à jour ci-dessus (modèle, durées, information, plan d'action). Ce qui a changé depuis le 2026-10-04, au regard des risques :

- **R1 (accès)** : le flux d'état de la page, sans jeton, ne cite plus jamais une valeur d'événement (lot C4) ; les journaux de la console sont datés et ne gardent plus de trace d'erreur ni de chemin (lot C1).
- **R2 (envoi erroné)** : « Accepter » porte le texte affiché, et seul ce texte est signé (lot B) ; « Refuser » demande confirmation.
- **R4 et l'ADR-0003** : le modèle ne peut plus être qu'à l'adresse de cette machine (lot D1).
- **T-09** : les noms que l'alerte présente comme une personne sont retirés par le code ; `npm run personne -- cartes` donne accès aux cartes qui citeraient une personne, et les efface (lot D2).
- **Point à trancher par le responsable** : la vraisemblance de R2 reste limitée tant que M3 (vraies réponses) n'est pas ouvert ; l'action 7 demande de revoir cette AIPD **avant** M3. Rien dans les traitements ouverts depuis (T-07 à T-09) ne remplit un critère de plus de la grille (`aipd-examen.md`) : ni profilage, ni décision automatisée, ni grande échelle. Ce n'est pas un avis juridique.

Rédigée par Claude le 2026-11-13. **À valider par le responsable.**

## 5. Validation

Risques résiduels jugés **acceptables** sous réserve des actions 1 à 6, réalisées **avant** toute lecture d'une vraie boîte, si le responsable de traitement le valide.

- Validé par : le dirigeant de Gnaro (EURL), responsable de traitement — le : 2026-10-04
  (validation donnée en session de travail ; actions 1 à 6 à réaliser avant toute lecture d'une vraie boîte).
- Avis du DPO : sans objet (pas de DPO désigné).
