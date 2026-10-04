# AIPD légère — Cénacle (2026-10-04)

> Analyse d'impact relative à la protection des données (RGPD art. 35), forme
> allégée, décidée le 2026-10-04 après l'examen `aipd-examen.md` (2 critères sur
> 9). Structure de la méthode PIA de la CNIL : contexte, principes
> fondamentaux, risques, plan d'action, validation. **Rédigée par Claude, à
> valider par le responsable de traitement** ; ce n'est pas un avis juridique.
> Fait vérifié le jour même : FileVault actif sur le Mac.

## 1. Contexte

**Responsable** : Gnaro (EURL), pour l'usage professionnel de son dirigeant.
**Machines** : le Mac seul : programmes, base PostgreSQL et services liés à `127.0.0.1`, et le modèle local, sur le même Mac (joint par son nom sur le tailnet, confirmé le 2026-10-04 : le contenu ne quitte pas la machine). La boîte reste chez OVH (France).

**Traitements couverts** (détail : `registre-traitements.md`) : T-01 relève et rangement, T-02 suivi et alertes, T-03 brouillons, T-04 envois acceptés, T-05 journal, T-06 traces sans contenu.

**Personnes concernées** : les correspondants de la boîte pro (clients, prospects, administrations, expéditeurs de lettres d'information), et les personnes citées dans leurs mails.

**Cycle de vie** : un mail est relu sur le serveur, en lecture seule → son objet et son texte sont donnés au modèle local, en mémoire, le temps d'un appel → seuls l'UID, la date, la case et des clés HMAC sont gardés (90 jours) → un brouillon peut être proposé (texte effacé 7 jours après la clôture) → s'il est accepté sur la page, l'exécuteur l'envoie, et la copie va dans mes Envoyés.

## 2. Principes fondamentaux

| Principe | Mise en œuvre | Suffisant ? |
|---|---|---|
| Finalités déterminées | Une par traitement, au registre ; une source n'est lue que déclarée | **Partiel** : le cadre exécutable est à coder (C1) |
| Base légale | Intérêt légitime, validé le 2026-10-04 pour T-01 à T-06 | Oui |
| Minimisation | Ni objet ni corps stockés ; clés HMAC au lieu des adresses ; le modèle ne voit qu'un mail à la fois | Oui |
| Exactitude | Vérificateur de faits sans IA ; cases douteuses laissées vides et visibles ; relecture humaine de chaque brouillon | Oui, avec les limites du registre IA |
| Durées | 90 jours (mémoire), 7 jours (texte des brouillons), 7 jours (traces) | **Partiel** : lignes de propositions et journal sans purge (C1) |
| Information | Mention publique sur le site, qui couvre aujourd'hui Legion (domaines seulement) | **Non** : à réviser pour Cénacle avant l'ouverture (C4) |
| Accès, rectification, effacement | `npm run personne` : export JSON, effacement, liste d'opposition qui le fait tenir (C3) | Oui |
| Opposition, limitation | Liste d'opposition : les mails de la personne ne sont plus lus ; couper la source | Oui |

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
- **Mesures** : aucun envoi sans mon acceptation **signée** par la page ; destinataire relu sur le serveur (l'expéditeur, jamais un Reply-To) ; délai d'annulation de 2 minutes ; plafond de 20 envois par jour ; vérificateur de faits ; banc : 0 envoi sans acceptation, 0 fait inventé ; envois limités aux domaines de test jusqu'à M3.
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
| 1 | Cadre exécutable, et durées et purges pour toutes les tables (propositions, journal) | Durées | C1 |
| 2 | ~~Plancher article 9, déterministe, avant le modèle~~ **fait le 2026-10-04** | R4 | C2 |
| 3 | ~~Export et effacement par adresse~~ **fait le 2026-10-04** | Droits | C3 |
| 4 | Mention révisée et publiée, vérifiée en ligne | Information | C4 |
| 5 | ~~Un fichier d'environnement par programme ; sauvegarde chiffrée des secrets~~ **fait le 2026-10-04** ; reste la liste d'opposition à protéger d'une perte de la base | R1 | S1 |
| 6 | Sentinelle sans contenu (ADR-0002) | Disponibilité | S2 |
| 7 | Revoir cette AIPD avant M3 (premiers envois réels), puis au plus tard le 2027-10-04 | Tous | — |

## 5. Validation

Risques résiduels jugés **acceptables** sous réserve des actions 1 à 6, réalisées **avant** toute lecture d'une vraie boîte, si le responsable de traitement le valide.

- Validé par : le dirigeant de Gnaro (EURL), responsable de traitement — le : 2026-10-04
  (validation donnée en session de travail ; actions 1 à 6 à réaliser avant toute lecture d'une vraie boîte).
- Avis du DPO : sans objet (pas de DPO désigné).
