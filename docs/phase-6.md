# Phase 6 — Le CTO

**Objectif** : un deuxième agent, le CTO de Gnaro. Il est l'expert technique de l'entreprise : il répond à mes questions, contrôle la qualité, pilote la sécurité (qu'un agent dédié surveille), vérifie la conformité, fait la veille, et comble mes manques d'expertise sur les projets en cours.
**Principe** : comme tout agent du Cénacle, il explique, propose et alerte ; **il n'agit jamais seul** (charte, règle 1 ; ADR-0004). Il commence petit — un projet, en local — et monte en charge jalon par jalon, comme Iris.

**Modèle** : choisi sur banc le 2026-10-09 : **Qwen 3.8 27B**, en local, partagé avec Iris (85 % des points attendus, une seule erreur mineure ; Qwen3-Coder 30B, plus rapide, inventait des faits). Un modèle en ligne ne viendra que si le local plafonne, dans le cadre de l'ADR-0003.

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **J1 — Le conseiller** (ADR-0017) | `npm run cto -- "question"` : il répond à mes questions techniques sur Cénacle, avec la documentation versionnée choisie par le code ; modèle local ; aucun outil ; rien n'est gardé ; une boîte « CTO » sur la page | Mes vraies questions sur Cénacle, et la boîte qui s'anime |
| J2 — La conversation (ADR-0020) | J2a : le CTO en service local, interrogé depuis la page ; J2b : `/cto` sur Telegram, sans donnée de tiers dans les questions | Une question posée depuis la page, puis depuis le téléphone |
| J3 — Le contrôle qualité (ADR-0021) | Lecture du code et relecture d'une branche (`npm run cto -- --relire <branche>`, expérimentale), par trois outils de lecture seule accordés par le code | Une relecture qui trouve un vrai défaut : un défaut mineur trouvé par la relecture libre ; J3b (par passes) : 2 sur 6 au banc, contre 0 — encore expérimentale |
| J4 — La conformité (ADR-0022) | Registres, cadre, code et documentation qui concordent : six contrôles déterministes dans `npm run check`, `npm run conformite`, et le regard du CTO (`npm run cto -- --conformite`) | Un écart réel signalé : cinq trouvés par les contrôles (dont `.env.sentinel` non documenté), deux par le CTO, corrigés |
| J5 — La veille (ADR-0024) | J5a : `npm run veille`, un résumé par article et ce qu'il apporte à un de mes projets, jamais deux fois la même info, archive d'un an (`npm run veille:archive`) ; J5b : chaque jour à 8 h sous launchd | Un résumé régulier utile ; **la veille actuelle sur n8n est alors supprimée** (après trois jours de comparaison) |
| J6 — L'agent sécurité (ADR-0025) | J6a : contrôles sans IA du Mac et des dépendances de Cénacle, constats suivis (anti-rebond, résolus, acceptés), catalogue fermé de corrections, mot du CTO ; une ronde toutes les 15 min (réseau une fois par heure), le grave dit tout de suite, le reste au rapport du matin (7 h 30) et au bilan du lundi ; `/etat` dit la dernière ronde ; J6b : décider depuis Telegram (✅ pris en charge, ☑ risque gardé, ❌ refus ; `/constats`) ; J6c : actions débloquées par mon accord ; J6d : délégations encadrées (`securite.toml`), gagnées par un carnet de confiance tenu à partir de mes décisions et perdues à la première erreur ; J6e : le serveur, l'agent surveillé, les autres projets | Une faille ou une mise à jour signalée et suivie |

Le périmètre s'élargit à mes autres projets au fil des jalons, un projet à la fois.

## Décisions (09/10)

- **Le rôle** : expert de l'entreprise, contrôle qualité, pilotage de la sécurité (un agent dédié surveille, le CTO supervise), conformité, veille, appui à tous les projets en cours.
- **Le modèle** : selon la tâche ; on part du local (banc du 09/10), un modèle en ligne seulement si le local plafonne.
- **Le départ** : le conseiller d'abord (J1), sur Cénacle seul.
- **Le nom** : plus tard ; d'ici là `cto` dans le code, « CTO » sur la page.
