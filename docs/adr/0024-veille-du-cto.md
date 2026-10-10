# ADR-0024 — La veille du CTO : un programme à part, des flux publics, le modèle local

**Statut** : acceptée (2026-10-10) — jalon J5 de la phase 6

## Contexte

La veille tournait sur n8n : chaque matin, six flux, une note et un résumé par un modèle local, un message Telegram. Elle ignorait mes projets (une note générique), ne suivait pas les versions de mes outils, n'apparaissait ni au journal ni aux registres, mettait le contenu des flux dans l'invite sans garde, et avalait les sources en panne : le flux d'Anthropic répondait 404 depuis le début, sans que personne le sache.

Le jalon J5 (`docs/phase-6.md`) la reprend dans Cénacle : « ce qui bouge dans mes technos, et ce qui m'est applicable ».

## Décision

1. **Un programme à part, `npm run veille`** (`apps/veille`), qui ne détient que le jeton Telegram. Le service du CTO ne détient aucun secret (S1) et n'en reçoit pas ; la veille parle au nom du CTO (le journal la range sous `cto`) sans passer par lui.
2. **Les sources dans `veille.toml`, versionné** : flux publics en https uniquement (actualité, et notes de version GitHub des outils de mes projets), réglages (fenêtre de 30 h, 50 articles au plus dont 8 par source, seuil 7, 12 retenus). **La carte de mes projets dans `veille.local.toml`, ignoré par git** (un nom, une ligne, une pile) ; sans lui, `veille.example.toml` et ses projets fictifs, et le message le dit.
3. **Une seule question au modèle local** (le modèle partagé, ADR-0003 ; jamais un autre en cas d'absence) : pour chaque article, une note ; au-dessus du seuil, un résumé de deux phrases et le projet qu'il servirait, avec une idée.
4. **Le contenu des flux n'est pas fiable** : les articles sont entre des marqueurs tirés au hasard, présentés comme des données ; le modèle ne rend que `{numéro, note, résumé, projet, idée}` ; titres et liens viennent toujours des flux ; toute adresse web écrite par le modèle est retirée ; un projet qu'il invente est ignoré ; le message est en texte brut.
5. **Le message dit toujours qu'il est généré par IA** (AI Act, art. 50), nomme les sources injoignables, ne dépasse jamais la limite de Telegram (ce qui ne tient pas est compté).
6. **Le modèle absent** : trois essais à dix minutes d'intervalle, puis un message « veille non faite ». **Rien n'est stocké** ; le journal reçoit des nombres (`veille.sent`, `veille.failed`).

## Conséquences

- Les flux lus voient l'adresse IP du Mac, rien d'autre ; certains sont hors UE. Aucune donnée personnelle ne leur est envoyée : ce ne sont pas des sous-traitants (registre, services tiers).
- Une invite d'une cinquantaine d'articles et de ma carte de projets : quelques minutes de modèle local par jour.
- Le lancement quotidien (launchd) et la fin de la veille n8n viennent avec J5b.

## Options écartées

- **Dans le service du CTO** : il faudrait lui donner le jeton Telegram, contre S1.
- **Dans le bot** : mêler une tâche longue du modèle au relais des commandes.
- **Garder n8n en lui ajoutant la carte des projets** : hors du journal, des registres et des tests, et les pannes y restent muettes.
