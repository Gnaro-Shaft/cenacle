# AIPD légère — Cénacle (2026-10-04)

> Analyse d'impact relative à la protection des données (RGPD art. 35), forme
> allégée, décidée le 2026-10-04 après l'examen `aipd-examen.md` (2 critères sur
> 9). Structure de la méthode PIA de la CNIL : contexte, principes
> fondamentaux, risques, plan d'action, validation. **Rédigée par Claude, à
> valider par le responsable de traitement** ; ce n'est pas un avis juridique.
> Fait vérifié le jour même : FileVault actif sur le Mac.

## 1. Contexte

**Responsable** : Gnaro (EURL), pour l'usage professionnel de son dirigeant.
**Machines** : le Mac (programmes, base PostgreSQL, tous liés à `127.0.0.1`) et la machine du modèle local, jointe par son adresse sur le tailnet. **À confirmer** : s'il s'agit du même Mac ou d'une autre machine à la maison ; dans le second cas, le contenu des mails transite chiffré sur le tailnet jusqu'à elle, et elle doit figurer ici et au registre. La boîte reste chez OVH (France).

**Traitements couverts** (détail : `registre-traitements.md`) : T-01 relève et rangement, T-02 suivi et alertes, T-03 brouillons, T-04 envois acceptés, T-05 journal, T-06 traces sans contenu.

**Personnes concernées** : les correspondants de la boîte pro (clients, prospects, administrations, expéditeurs de lettres d'information), et les personnes citées dans leurs mails.

**Cycle de vie** : un mail est relu sur le serveur, en lecture seule → son objet et son texte sont donnés au modèle local, en mémoire, le temps d'un appel → seuls l'UID, la date, la case et des clés HMAC sont gardés (90 jours) → un brouillon peut être proposé (texte effacé 7 jours après la clôture) → s'il est accepté sur la page, l'exécuteur l'envoie, et la copie va dans mes Envoyés.

## 2. Principes fondamentaux

| Principe | Mise en œuvre | Suffisant ? |
|---|---|---|
| Finalités déterminées | Une par traitement, au registre ; une source n'est lue que déclarée | **Partiel** : le cadre exécutable est à coder (C1) |
| Base légale | Intérêt légitime, à valider traitement par traitement | À valider |
| Minimisation | Ni objet ni corps stockés ; clés HMAC au lieu des adresses ; le modèle ne voit qu'un mail à la fois | Oui |
| Exactitude | Vérificateur de faits sans IA ; cases douteuses laissées vides et visibles ; relecture humaine de chaque brouillon | Oui, avec les limites du registre IA |
| Durées | 90 jours (mémoire), 7 jours (texte des brouillons), 7 jours (traces) | **Partiel** : lignes de propositions et journal sans purge (C1) |
| Information | Mention publique sur le site, qui couvre aujourd'hui Legion (domaines seulement) | **Non** : à réviser pour Cénacle avant l'ouverture (C4) |
| Accès, rectification, effacement | — | **Non** : export et effacement par adresse à coder (C3) |
| Opposition, limitation | Couper la source ; une règle de rangement peut écarter un expéditeur | Partiel (C1, C3) |

## 3. Risques

Échelle CNIL : négligeable, limitée, importante, maximale. Évalués **après** les mesures déjà en place et celles prévues **avant l'ouverture** (C1 à C4, S1, S2).

### R1 — Accès illégitime aux données

- **Impacts** : divulgation du contenu de brouillons (propos de correspondants), de la liste des mails en attente ; usage du mot de passe de la boîte.
- **Sources** : vol ou compromission du Mac ; programme compromis sur le Mac ; fuite d'un secret.
- **Mesures** : FileVault ; programmes, base et services liés à `127.0.0.1` ; page protégée par un jeton tiré à chaque démarrage, origine et nom d'hôte vérifiés ; rôles séparés en base, signatures de la page (ADR-0013) ; aucun contenu dans le journal, les traces ni Telegram.
- **Faiblesses** : un seul compte macOS (ADR-0013) ; secrets de tous les programmes dans un même `.env` jusqu'à S1 ; aucune sauvegarde chiffrée des secrets aujourd'hui.
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
- **Mesures** : traitement local, rien n'est stocké du contenu ; **plancher déterministe à coder avant l'ouverture (C2)**.
- **Gravité : importante. Vraisemblance : limitée**, une fois C2 en place.

### R5 — Disparition des données

- **Impacts** : perte de la mémoire des mails (elle se relit) ou de l'historique des propositions.
- **Gravité : négligeable. Vraisemblance : limitée.**

## 4. Plan d'action

| # | Action | Risque | Jalon |
|---|---|---|---|
| 1 | Cadre exécutable, et durées et purges pour toutes les tables (propositions, journal) | Durées | C1 |
| 2 | Plancher article 9, déterministe, avant le modèle | R4 | C2 |
| 3 | Export et effacement par adresse | Droits | C3 |
| 4 | Mention révisée et publiée, vérifiée en ligne | Information | C4 |
| 5 | Un fichier d'environnement par programme ; sauvegarde chiffrée des secrets (`CENACLE_MAIL_KEY`, clés de la page, mot de passe de l'exécuteur) | R1 | S1 |
| 6 | Sentinelle sans contenu (ADR-0002) | Disponibilité | S2 |
| 7 | Revoir cette AIPD avant M3 (premiers envois réels), puis au plus tard le 2027-10-04 | Tous | — |

## 5. Validation

Risques résiduels jugés **acceptables** sous réserve des actions 1 à 6, réalisées **avant** toute lecture d'une vraie boîte, si le responsable de traitement le valide.

- Validé par : _à compléter_ — le : _à compléter_
- Avis du DPO : sans objet (pas de DPO désigné).
