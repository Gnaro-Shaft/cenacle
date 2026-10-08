# Phase 6 — Le CTO

**Objectif** : un deuxième agent, le CTO de Gnaro. Il est l'expert technique de l'entreprise : il répond à mes questions, contrôle la qualité, pilote la sécurité (qu'un agent dédié surveille), vérifie la conformité, fait la veille, et comble mes manques d'expertise sur les projets en cours.
**Principe** : comme tout agent du Cénacle, il explique, propose et alerte ; **il n'agit jamais seul** (charte, règle 1 ; ADR-0004). Il commence petit — un projet, en local — et monte en charge jalon par jalon, comme Iris.

**Modèle** : choisi sur banc le 2026-10-09 : **Qwen 3.8 27B**, en local, partagé avec Iris (85 % des points attendus, une seule erreur mineure ; Qwen3-Coder 30B, plus rapide, inventait des faits). Un modèle en ligne ne viendra que si le local plafonne, dans le cadre de l'ADR-0003.

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **J1 — Le conseiller** (ADR-0017) | `npm run cto -- "question"` : il répond à mes questions techniques sur Cénacle, avec la documentation versionnée choisie par le code ; modèle local ; aucun outil ; rien n'est gardé ; une boîte « CTO » sur la page | Mes vraies questions sur Cénacle, et la boîte qui s'anime |
| J2 — La conversation | Lui écrire depuis Telegram et la page | Une question posée depuis le téléphone |
| J3 — Le contrôle qualité | Lecture du code et relecture d'une pull request, par des outils de lecture seule accordés par le code | Une relecture qui trouve un vrai défaut |
| J4 — La conformité | Registres, cadre, code et documentation qui concordent | Un écart réel signalé |
| J5 — La veille | Ce qui bouge dans mes technos, et ce qui m'est applicable | Un résumé régulier utile ; **la veille actuelle sur n8n est alors supprimée** |
| J6 — L'agent sécurité | Un second agent qui surveille (Mac, VPS, dépendances, failles), supervisé par le CTO | Une faille ou une mise à jour signalée et suivie |

Le périmètre s'élargit à mes autres projets au fil des jalons, un projet à la fois.

## Décisions (09/10)

- **Le rôle** : expert de l'entreprise, contrôle qualité, pilotage de la sécurité (un agent dédié surveille, le CTO supervise), conformité, veille, appui à tous les projets en cours.
- **Le modèle** : selon la tâche ; on part du local (banc du 09/10), un modèle en ligne seulement si le local plafonne.
- **Le départ** : le conseiller d'abord (J1), sur Cénacle seul.
- **Le nom** : plus tard ; d'ici là `cto` dans le code, « CTO » sur la page.
