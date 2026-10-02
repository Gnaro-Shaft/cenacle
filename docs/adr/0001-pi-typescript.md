# ADR-0001 — TypeScript + Pi ; pas de LangChain ; LangGraph différé

**Statut** : acceptée (2026-10-02)

## Contexte

Cénacle est une équipe d'agents personnels. Les projets précédents de l'auteur étaient en Python avec LangGraph. Ce projet a deux objectifs : être utile au quotidien, et **apprendre** à construire soi-même ce que les frameworks fournissent d'habitude (orchestration, permissions, sous-agents).

## Décision

- **Langage : TypeScript**, sur Node ≥ 22.
- **Moteur d'agent : Pi** (`pi-agent-core`, `pi-ai`, monorepo `pi-mono`, licence MIT). C'est un cœur minimal : boucle d'agent, appels d'outils, événements, sessions persistées. Il n'a ni permissions, ni sous-agents, ni MCP natif ; on les construit, ou on les ajoute en extensions.
- **Pas de LangChain** : `pi-ai` couvre déjà l'abstraction des fournisseurs de modèles.
- **LangGraph différé** : il ferait doublon avec la boucle d'agent de Pi. On le réévaluera quand plusieurs agents devront collaborer, **sur un besoin mesuré** (par exemple une reprise sur checkpoint que notre code ne gère pas bien).

## Conséquences

- Les permissions sont à notre charge, et c'est voulu : voir ADR-0004 et la charte (règles 1 et 2).
- Le code des projets Python précédents n'est pas réutilisable. Leurs décisions, elles, le sont.
- **À vérifier à l'installation** : le *scope* npm exact des paquets Pi (le dépôt a changé d'organisation), et la télémétrie émise par défaut, qu'on coupe et dont on teste l'absence.

## Alternatives écartées

- **Python + LangGraph** : maîtrisé, mais n'apprend rien de neuf et ne correspond pas au choix de Pi.
- **Pi en TypeScript + LangGraph en Python** : deux langages et deux environnements d'exécution, trop de pièces pour un premier lot.
