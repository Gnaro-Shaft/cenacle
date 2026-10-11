# ADR-0026 — Délégations et carnet de confiance ; la fusion par mon bouton

**Statut** : acceptée (2026-10-11) — jalon J6d de la phase 6 ; complète l'ADR-0025

## Contexte

J6c laisse l'agent sécurité préparer, sur mon 🔧, la PR qui corrige une faille de dépendance. Le dirigeant veut deux choses de plus (2026-10-10) : **fusionner depuis Telegram**, d'un bouton ; et qu'**à terme le CTO règle seul les cas simples**, dans des règles précises — la récompense d'un agent qui travaille bien. Une récompense qui réentraînerait le modèle a été écartée : lourde en local, et sujette au « piratage de la récompense » (plaire à la mesure plutôt que bien faire). La récompense est **l'autonomie**, gagnée sur des faits et perdue à la première erreur.

## Décision

1. **✅ Fusionner, par mon bouton, PR par PR.** Quand la CI d'une PR préparée par l'agent passe au vert, la ronde m'envoie **✅ Fusionner / ❌ Fermer**, liés au **commit que la CI a testé**. Mon appui enregistre la demande (jeton à usage unique, mon compte seul) ; la ronde suivante **revérifie tout** — PR ouverte, vers `main`, toujours ce commit, CI verte sur lui, fichiers de paquets seulement — puis fusionne en nommant ce commit à GitHub (`--match-head-commit`) : un commit poussé entre-temps fait échouer la fusion. ❌ ferme la PR et supprime sa branche. **La fusion n'existe que dans `apps/securite/src/merge.ts`**, importé par le seul branchement des actions — un test le vérifie. **La fusion n'est jamais déléguable.**
2. **Le carnet de confiance**, compté par du code déterministe à partir de faits que **je** produis : pour chaque PR de l'agent, son issue — fusionnée sans retouche (le seul commit de l'agent), fusionnée retouchée, fermée sans fusion, CI en échec — journalisée (`securite.action`), sur la durée du journal (180 jours). **Le modèle n'y écrit jamais.**
3. **Les délégations** : une liste fermée dans le code (aujourd'hui une seule : *préparer la PR d'une faille npm sans version majeure*) ; `securite.toml`, versionné, hors de portée de l'agent (ses PR ne touchent que des fichiers de paquets), en fixe le **seuil** (5) et, quand je l'accorde, la **date** (`accordee_le`, par une PR).
   - Seuil atteint (5 PR fusionnées sans retouche, **aucun** échec) : le CTO me la **propose, une fois**, avec la ligne à ajouter.
   - Accordée : la ronde prépare d'elle-même la PR d'une faille corrigible sans version majeure, puis me prévient ; **la fusion reste mon bouton**.
   - **Un seul échec** d'une PR faite en délégation (CI en échec, fermée sans fusion, retouchée) la **suspend aussitôt** (`securite.delegation`) ; seule une date d'accord plus récente la rétablit.
4. **Le bilan du lundi** montre le carnet et l'état de chaque délégation (en apprentissage, proposable, déléguée, suspendue).
5. **Aucune IA dans une décision** : ni la fusion, ni l'accord, ni la suspension.

## Conséquences

- Le carnet est vide tant qu'aucune faille npm n'a été corrigée ; la délégation ne se démontrera en vrai qu'après cinq PR.
- Fusionner depuis un téléphone tente de ne pas regarder : le bouton n'existe que pour une PR qui ne touche que le verrouillage, CI verte, et le message nomme le paquet, les versions et le commit.
- Les agents de Legion avaient des « délégations » (`propositions/delegations.py`) : même esprit — type exact, révocable, tracé, jamais pour ce qui demande un administrateur ; ici gagnées par un carnet.

## Options écartées

- **Récompenser en réentraînant le modèle** : lourd, opaque, piratable.
- **Accorder par un bouton** : un accord stocké en base se falsifie plus facilement qu'une PR relue et versionnée.
- **Déléguer la fusion** : refusé — l'agent prépare, je décide.
