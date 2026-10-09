# ADR-0006 — Page web installable (PWA) pour lire et valider ; Telegram pour le chat et les compteurs

**Statut** : acceptée (2026-10-02)

## Décision

- **La page Cénacle** (React) est l'interface principale, sur ordinateur comme sur téléphone, où elle s'**installe en PWA** sur l'écran d'accueil. Elle n'est joignable **que par Tailscale**, avec l'identité Tailscale de l'utilisateur et une protection CSRF sur les actions.
- **Notifications Web Push sans contenu** (« 1 brouillon à valider »). La charge utile est chiffrée de bout en bout (RFC 8291). Le détail se charge dans l'application, par Tailscale. Sur iOS, le Web Push exige une PWA ajoutée à l'écran d'accueil (iOS ≥ 16.4).
- **Telegram** sert au **chat** avec les agents et aux **compteurs** :
  - en *long polling* : aucun port public ;
  - réponses limitées au seul `chat_id` autorisé ;
  - **aucun contenu de mail** : les messages de bot ne sont pas chiffrés de bout en bout ;
  - **aucune validation d'envoi** : on ne valide pas ce qu'on n'a pas lu.
  - *complément (2026-10-09, ADR-0020)* : `/cto` y transmet mes questions techniques au CTO et ses réponses — aucun contenu de mail (le CTO n'en lit aucun) et, par règle, aucune donnée de tiers dans mes questions.
- **Commande d'arrêt** disponible partout : un bouton « tout arrêter » sur la page, `/stop` sur Telegram.

## Alternatives écartées

- **Validation dans Telegram avec le contenu** : le contenu transiterait en clair chez Telegram.
- **Validation par bouton Telegram sans contenu** : ce serait valider à l'aveugle.
- **ntfy auto-hébergé** : une brique de plus à maintenir, pour un gain marginal sur la PWA.
