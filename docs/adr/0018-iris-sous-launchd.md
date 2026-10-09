# ADR-0018 — Iris lancée par launchd, relancée seulement si elle plante, une seule à la fois

**Statut** : acceptée (2026-10-09) — complète l'ADR-0013

## Contexte

Iris tourne sur mon Mac et je la lance à la main (`npm run iris`). Le 08/10, après un plantage du Mac, elle est restée arrêtée de 12:33 à 23:48, jusqu'à ce que je la relance. La sentinelle m'a prévenu, mais rien ne la relançait.

L'ADR-0013 renvoyait les choix de déploiement (utilisateurs, lancement) à plus tard. Deux contraintes pèsent sur le lancement automatique :

- l'**arrêt d'urgence** (`/stop` sur Telegram, charte) doit rester un arrêt : rien ne doit relancer Iris derrière moi ;
- **rien n'empêchait deux Iris** de tourner ensemble (une à la main, une lancée automatiquement) : chaque relève et chaque alerte en double.

## Décision

1. **Un agent `launchd` de mon compte** démarre Iris à l'ouverture de session. Il est écrit sur le Mac par `npm run iris:service -- install`, que je lance moi-même, à partir des chemins trouvés à l'installation : aucun chemin personnel dans le dépôt.
2. **Relancée seulement si elle plante** (`KeepAlive` → `SuccessfulExit: false`), avec 30 s entre deux démarrages (Docker ou le modèle peuvent être encore en train de démarrer). Un `/stop`, un Ctrl+C ou un `SIGTERM` (déconnexion, désinstallation) l'arrêtent proprement, avec le code 0 : elle n'est **jamais** relancée derrière eux.
3. **Une seule Iris à la fois** : au démarrage, Iris prend un verrou consultatif PostgreSQL sur une connexion à elle, tenu toute sa vie ; il tombe seul si le processus meurt. Une deuxième Iris refuse de démarrer, avec le code 75 (« réessayer plus tard ») : celle de `launchd` réessaie donc, et prend le relais quand l'autre s'arrête. Sans base, pas de verrou, pas de démarrage.
4. **Aucun secret dans l'agent** : il désigne le lanceur (`deploy/launchd/run.sh`), qui charge les mêmes fichiers `.env*` que `npm run iris` ; aucune valeur n'est recopiée. L'installeur lui-même ne charge aucun secret.
5. **Le journal de la console** (`~/Library/Logs/cenacle/iris.log`) ne contient que des lignes d'état et des noms d'erreur, jamais un contenu de mail. Il est vidé au démarrage au-delà de 1 Mo : sa taille, donc sa durée de conservation, est bornée.

## Conséquences

- Après un redémarrage ou un plantage du Mac, Iris repart dès que j'ouvre ma session ; après un plantage d'Iris seule, dans les 30 s.
- Mac en veille ou absent : Iris est en pause, comme avant ; la relève suivante rattrape (ADR-0016).
- Docker Desktop et LM Studio (service et modèle) doivent démarrer avec ma session : réglages à faire de mon côté (`deploy/launchd/README.md`). D'ici là, Iris démarre, constate leur absence, et réessaie.
- Le serveur de la page et le bot Telegram restent lancés à la main ; ils suivront le même mécanisme dans un second temps.
- La séparation en utilisateurs macOS distincts (ADR-0013) reste à décider.

## Options écartées

- **`KeepAlive` toujours vrai** : relancerait Iris après un `/stop` — l'arrêt d'urgence ne serait plus un arrêt.
- **Un fichier de verrou (pidfile)** : survit à un plantage et bloque la relance, ou se fait réutiliser par un autre processus ; le verrou PostgreSQL tombe avec la connexion.
- **Recopier les variables dans le plist** : les secrets se retrouveraient dans un fichier de plus, lisible par tous les programmes du compte.
