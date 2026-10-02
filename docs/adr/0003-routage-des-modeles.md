# ADR-0003 — Le contenu des mails ne quitte jamais le modèle local ; s'il est indisponible, on attend

**Statut** : acceptée (2026-10-02)

## Décision

- Le **routeur de modèles est du code**, testé, et non un choix du modèle.
- Toute tâche qui touche **le contenu d'un mail** (classement, résumé, brouillon) va **uniquement au modèle local**, sur le Mac.
- Une API européenne (Mistral) n'est autorisée que pour des tâches **sans donnée personnelle**. Elle est soumise à un contrat de sous-traitance et à l'opt-out d'entraînement.
- Si le modèle local est indisponible (Mac en veille), **la tâche attend**. Il n'y a **jamais de bascule silencieuse** vers le cloud, ni vers un modèle de secours.
- Chaque décision de routage est **journalisée** : tâche, classe de donnée, destination, motif.

## Conséquences

- Mac en veille = mails non traités. L'agent s'affiche « au repos — en attente du Mac » (ADR-0008).
- Un test vérifie qu'une tâche marquée « contenu de mail » ne peut pas être routée ailleurs que vers le local, même si on configure le routeur de travers.

## Alternatives écartées

- **Petit modèle CPU sur le VPS en secours** : il sortirait du contenu de chez soi, pour un classement moins fiable. À réévaluer seulement si l'attente gêne réellement.
- **API en secours** : contraire au principe local d'abord pour les données personnelles.
