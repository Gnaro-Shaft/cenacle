# ADR-0022 — La concordance des registres, du cadre, du code et de la documentation est vérifiée par le code

**Statut** : acceptée (2026-10-09) — complète l'ADR-0009

## Contexte

L'ADR-0009 veut que le registre des traitements soit un fichier que le code applique : le cadre (`cadre.toml`) porte les durées, la purge les applique. Mais rien ne vérifiait que les registres écrits pour les humains (`docs/conformite/`) disaient la même chose que le cadre et le code. Un registre pouvait annoncer 90 jours quand le cadre en applique 60, une table naître sans purge, une famille de secrets exister sans être documentée.

Le jalon J4 du CTO (`docs/phase-6.md`) vise cette concordance. La leçon de J3b s'applique : ce que le code peut vérifier, c'est au code de le vérifier, pas au modèle.

## Décision

1. **Six contrôles déterministes, sans IA** (`packages/conformite`), lancés par `npm run check`, donc par la CI :
   - **durées** : chaque durée du registre des traitements porte la clé du cadre qu'elle applique (« 90 jours (`memoire_jours`) ») et lui est égale, dans `cadre.toml` et `cadre.local.example.toml` ; chaque clé du cadre est citée ; la durée des traces égale la rétention de `tempo.yaml` ;
   - **tables** : chaque table créée par les migrations est déclarée au registre, avec le fichier qui la purge (et ce fichier la purge vraiment), ou « aucune donnée personnelle » et sa raison ;
   - **services** : chaque hôte externe que le code contacte figure parmi les services tiers ;
   - **IA** : chaque agent qui appelle un modèle est nommé au registre IA ; chaque ligne cite un ADR qui existe ;
   - **secrets** : les familles de secrets du code et celles de `docs/securite/secrets.md` sont les mêmes ;
   - **références** : chaque ADR, script ou chemin du dépôt cité dans `docs/conformite/` et `docs/securite/` existe.
2. **Un écart fait échouer la vérification**, sauf s'il est déclaré dans `docs/conformite/exceptions.md`, avec sa raison et sa date. Une exception sans raison ni date, ou qui n'excuse plus rien, est elle-même un écart. Un registre dont un tableau ne se lit pas est un écart, jamais une réussite silencieuse.
3. **`npm run conformite`** donne le rapport, et compare aussi, en local, les durées réelles de `cadre.local.toml` — ses seules quatre durées, rien d'autre de ce fichier.
4. **Le CTO éclaire** (`npm run cto -- --conformite`) : il reçoit le rapport et cherche ce que le code ne sait pas trancher (un ADR récent qui crée un traitement ou un usage de l'IA absent des registres, une mention d'information incomplète). Sa passe est expérimentale, ses références vérifiées.

## Conséquences

- Au premier passage (09/10), les contrôles ont trouvé de vrais écarts, corrigés dans la même PR : `.env.sentinel` absent de la documentation des secrets ; trois lignes du registre IA (IA-02 à IA-04) sans ADR ; le second bot Telegram de la sentinelle absent du registre ; aucune durée reliée à sa clé du cadre ; aucune table déclarée.
- Toute évolution qui touche une durée, une table, un hôte, un agent ou un secret doit mettre à jour le registre dans le même changement.
- Ce sont des contrôles de **cohérence**, pas un avis juridique : ils ne disent pas qu'une durée est juste, seulement que le registre, le cadre et le code disent la même.

## Options écartées

- **Confier la concordance au modèle** : il manque ce qu'un test attrape à coup sûr (constaté au banc de J3b).
- **Un rapport non bloquant** : un écart qu'on ne corrige pas finit par ne plus se voir.
- **Des registres en YAML ou en JSON** : lisibles par le code, moins par moi ; les tableaux Markdown restent lus strictement.
