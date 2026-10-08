# ADR-0017 — Le CTO, un conseiller technique local qui n'agit jamais

**Statut** : acceptée (2026-10-09) — complète l'ADR-0003, l'ADR-0004 et l'ADR-0005

## Contexte

Le Cénacle accueille un deuxième agent, le CTO de Gnaro (`docs/phase-6.md`) : l'expert technique de l'entreprise. Son premier jalon (J1) est de répondre à mes questions techniques sur un projet.

Il lit beaucoup : de la documentation, plus tard du code. Il pourrait, s'il était mal conçu, devenir un chemin vers mes secrets ou ma boîte mail. Et le modèle qui lui répond peut se tromper avec assurance.

Le banc du 2026-10-09 a comparé deux modèles locaux sur 17 questions sur Cénacle : Qwen 3.8 27B couvre 85 % des points attendus avec une erreur mineure ; Qwen3-Coder 30B, deux fois plus rapide, inventait des faits (fichiers, règles, citations d'ADR).

## Décision

1. **Il conseille, il n'agit jamais.** Il explique, propose, alerte. Il n'écrit dans aucun dépôt, ne fusionne rien, ne touche à aucune infrastructure, n'envoie rien. Toute action reste mienne (charte, règle 1 ; ADR-0004).
2. **Aucun outil en J1.** Le modèle reçoit une question et un contexte, et rend du texte. Des outils de lecture seule viendront au jalon J3, accordés par le code, jamais par le modèle (charte, règle 2).
3. **Le contexte est choisi par le code**, pas par le modèle : la documentation **versionnée** du projet (fichiers suivis par git : README, `CLAUDE.md`, `docs/`), dans un budget de taille et un ordre fixe. Jamais un fichier `.env*`, `*.local.toml`, ni `fixtures/` ; jamais un lien symbolique ; jamais hors du dépôt ; un fichier dont le texte ressemble à une clé ou à un secret est écarté entier.
4. **Le modèle local** (Qwen 3.8 27B, partagé avec Iris), conformément à l'ADR-0003, inchangé : la question est traitée comme pouvant contenir une donnée personnelle, donc **uniquement en local**. Réflexion désactivée ; délai maximal ; modèle injoignable = erreur explicite, jamais de bascule.
5. **Il ne détient aucun secret.** Le CTO refuse de démarrer si une variable d'une famille de secrets (mail, page, exécuteur, Telegram, propriétaire, sentinelle…) est présente : il n'a aucun moyen d'atteindre ma boîte ni d'accepter quoi que ce soit (ADR-0013).
6. **Rien n'est gardé.** Ni la question ni la réponse ne sont stockées ni journalisées : le journal reçoit des faits (routage, état, compteurs de la réponse) sous l'agent `cto`, comme pour Iris (ADR-0008).
7. **Il se voit.** Une boîte « CTO » sur la page montre s'il réfléchit, se repose ou est malade.

## Conséquences

- Il ne sait que ce que la documentation dit : ce qui n'est écrit que dans le code lui échappe (constaté au banc), jusqu'au jalon J3.
- Il peut se tromper : ses réponses sont des avis à vérifier, pas des faits établis (registre IA, IA-05).
- Iris et lui partagent le modèle : s'ils travaillent en même temps, leurs demandes passent l'une après l'autre.
- Aucun nouveau sous-traitant, aucun transfert : tout reste sur le Mac.

## Options écartées

- **Un modèle en ligne dès J1** : plus compétent, mais un sous-traitant hors UE et un nouvel ADR pour un besoin pas encore mesuré ; on part du local.
- **Laisser le modèle choisir les fichiers qu'il lit** (un outil de lecture dès J1) : il serait manipulable par ce qu'il lit ; le choix reste au code.
- **Garder l'historique des questions** : utile plus tard, mais sans finalité ni durée de conservation décidées ; rien n'est gardé en J1.
