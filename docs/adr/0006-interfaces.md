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

## Révision du 2026-10-14 — l'allure de la page, dans l'esprit de Myriade

Le personnage provisoire en formes CSS (phase 1, J5) laisse place à l'identité de Legion, gnaro.fr et Myriade : papier chaud et encre brune, Fraunces pour les titres, Newsreader pour le texte, **le rouge seulement pour ce qui compte** (ce qui attend ma décision, ce qui est en panne), l'ambre pour le travail en cours. Chaque agent est un emblème au trait dans un anneau — une enveloppe pour Iris, une boussole pour le CTO — dont la couleur dit l'état et que la carte redit toujours en mots ; une seule animation, la pulsation de l'anneau au travail, coupée quand le système demande moins de mouvement. La page passe en deux colonnes : « À décider » et la question au CTO à gauche, l'équipe et le courrier à droite ; une seule colonne sur un écran étroit.

- Les polices sont servies par la page elle-même (`apps/web/public/polices/`) : aucun appel à un tiers. Le dépôt étant public, elles y sont redistribuées avec le texte complet de leur licence (SIL OFL 1.1).
- Une page d'aperçu (`/apercu.html`, serveur de développement seulement) montre tous les états avec des données fictives ; elle remplace `fetch` par un refus avant tout rendu et n'ouvre aucun flux.
- Rien ne change dans l'API, le jeton, le port ni la réponse du CTO en texte brut (ADR-0019, ADR-0020).
