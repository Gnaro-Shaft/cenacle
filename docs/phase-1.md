# Phase 1 — Le socle

**Objectif** : voir Iris vivre à l'écran et sur Telegram, sans aucun mail réel. Tout tourne sur le Mac.
**Critère de sortie** : un événement simulé fait changer Iris d'état sur la page **et** sur Telegram ; un vrai appel au modèle local la fait passer « en activité » puis « au repos » ; tout est tracé sans contenu ; la revue de sécurité du socle est passée.

Chaque jalon est **petit, exécutable seul, et finit par une démonstration**. On ne passe au suivant qu'une fois la démonstration faite.

| Jalon | Contenu | Démonstration (critère) | Ce que j'apprends |
|---|---|---|---|
| **J1 — Le dépôt propre** | `git init`, `LICENSE` + `NOTICE` (Apache-2.0), README (EN) squelette, `.gitignore`, `.env.example`, `gitleaks` en pré-commit, `CLAUDE.md` qui renvoie à la charte | Un faux secret commité est **bloqué** par le pré-commit | Hygiène d'un dépôt public |
| **J2 — Le squelette TypeScript** | Node 22, *npm workspaces* (`apps/server`, `apps/web`, `packages/core`), TypeScript strict, un linter, Vitest, CI GitHub Actions (lint, types, tests, `gitleaks`, `npm audit`) | `npm run check` vert en local **et** en CI | Monorepo TS, CI |
| **J3 — Le journal** | PostgreSQL en Docker Compose, table `events`, déclencheurs qui interdisent `UPDATE`/`DELETE`, fonctions `append` / `read` | Test adversarial : un `UPDATE` ou un `DELETE` est **refusé par la base** | Event sourcing, garanties portées par le moteur |
| **J4 — L'état d'Iris** | Projection pure *événements → état* (repos / activité / malade + bulle) | Tests : événement inconnu → **erreur visible** (pas d'échec silencieux) ; ordre des événements respecté | Projections, états dérivés |
| **J5 — La case d'Iris** | Serveur **Hono** + SSE ; page React avec **une case** et un personnage provisoire (formes CSS) aux 3 états + bulle ; commande `simulate` | `npm run simulate -- sick` → Iris **tombe malade à l'écran, en direct** | SSE, React, animation CSS |
| **J6 — Iris sur Telegram** | Bot en *long polling*, `chat_id` autorisé seul, commandes `/etat` et `/stop` (journalisées) | `/etat` répond l'état réel ; un autre compte est **ignoré et journalisé** | API Bot Telegram, allowlist |
| **J7 — Premier souffle de Pi** | `pi-ai` / `pi-agent-core` vers le modèle local (LM Studio) ; routeur minimal « contenu de mail → local uniquement » ; télémétrie coupée et **prouvée** | Un appel réel fait passer Iris *en activité* puis *au repos* ; modèle éteint → **malade**, pas de bascule cloud | Pi, routage, appels LLM |
| **J8 — Les yeux** | OpenTelemetry → Tempo → Grafana dans le Compose | La trace de l'appel J7 est visible, et un test prouve qu'**aucun texte** n'est dans les spans | Observabilité de systèmes d'agents |
| **Revue** | Ports (tout lié à `localhost` ou Tailscale), secrets, dépendances, licences | Rien d'ouvert sur le réseau local hors Tailscale ; `gitleaks` propre sur tout l'historique | Audit |

## Avant J1 — à faire par moi

- [x] Créer le dépôt GitHub `cenacle` — créé **public** : rien ne doit être poussé avant que J1 soit en place
- [x] Renommer le dossier local du projet en `cenacle`
- [x] Vérifier Node ≥ 22 et Docker sur le Mac (Node 26.8, Docker 29.3)
- [ ] J6 : créer le bot Telegram auprès de BotFather (le jeton ira dans `.env`, jamais ailleurs)
