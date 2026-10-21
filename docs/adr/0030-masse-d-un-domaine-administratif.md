# ADR-0030 — Le courrier de masse d'un domaine administratif va au modèle, plafonné

**Statut** : acceptée (2026-10-21) — complète le point 2 de l'ADR-0029

## Contexte

La simulation M2 du 2026-10-21 (`docs/mesures/m2.md`, 215 mails réels) a mesuré le tri d'aujourd'hui à 91,2 %. La règle du courrier de masse (ADR-0029) y a raison 111 fois sur 126 ; ses erreurs sont d'un seul côté : **15 vrais mails administratifs** portent eux aussi des en-têtes de masse. Des services mettent `List-Unsubscribe` jusque dans leurs envois utiles (relevés, factures, avis de compte), et l'ADR-0029 les envoyait d'office en « Bruit », même quand leur domaine a une règle « Administratif ».

## Décision

1. **Un mail de masse dont le domaine a une règle « Administratif » est lu par le modèle**, au lieu d'aller d'office en « Bruit ». Le modèle distingue une facture d'une publicité par son contenu ; ses mails passent par le plancher article 9 comme les autres.
2. **La réponse du modèle a un plafond : la case de la règle.** « Clients et prospects » devient « Administratif » ; « Administratif », « Bruit » et « À trier » restent. Le principe de l'ADR-0029 tient : des en-têtes que n'importe qui peut écrire ne font jamais monter un mail au-dessus de ce que dit ma règle.
3. **Le plafond est appliqué avant tout enregistrement** (`classify` de `sortByModel`) : la base, le journal et les compteurs disent la même case.
4. **Rien n'est gardé de plus** : le plafond est recalculé à la lecture du mail pour le modèle, depuis la même source (`readMailsForSortingAt`, `massOfSource`), y compris pour un mail qui attendait le modèle depuis une relève précédente. `decided_by` reste `model`.
5. **Le reste de l'ADR-0029 ne change pas** : le courrier de masse d'un domaine inconnu ou d'un domaine en règle « Bruit » va en « Bruit » ; une règle « Clients et prospects » décide avant tout ; le courrier ordinaire d'un domaine administratif suit sa règle.

## Conséquences

- La correction ne vaut que pour les domaines qui ont une règle « Administratif » : mes expéditeurs administratifs connus doivent être dans `regles.local.toml`. La prochaine simulation dira combien des 15 erreurs venaient de domaines sans règle.
- Le modèle lit un peu plus de mails par relève (le courrier de masse de mes domaines administratifs).
- La mesure ne compte pas ces mails à part : ils sont comptés avec le modèle (décidé le 2026-10-21, pour éviter une migration).

## Options écartées

- **Laisser le modèle libre**, sans plafond : une publicité d'un domaine administratif prise pour un client déclencherait relances et brouillons.
- **Une liste d'exceptions par domaine** : à tenir à la main ; elle reste possible plus tard si le modèle se trompe sur ces mails.
- **Faire passer la règle « Administratif » avant le courrier de masse** : c'était l'état d'avant l'ADR-0029, avec 37 mails de bruit rangés en « Administratif ».
