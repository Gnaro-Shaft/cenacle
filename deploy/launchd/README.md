# Cénacle lancé par launchd (ADR-0018, ADR-0019)

Iris, le serveur de la page, le bot Telegram et la page démarrent à l'ouverture de session. Chacun repart s'il plante, jamais après `/stop`, Ctrl+C ou une déconnexion.

## Installer, vérifier, retirer

```bash
npm run service -- install all       # écrit et démarre les quatre agents launchd
npm run service -- status all        # chargé ? pid ? dernier code de sortie ?
npm run service -- uninstall all     # les arrête et les retire
```

On peut viser un seul programme : `iris`, `server`, `bot` ou `web` à la place de `all`. `npm run iris:service -- install` fait la même chose pour Iris seule.

Avant d'installer, arrête ce que tu as lancé à la main (Ctrl+C). Si tu l'oublies, rien de grave : Iris, le serveur et le bot n'acceptent qu'un exemplaire à la fois. Celui de launchd réessaie toutes les 30 s, puis prend le relais quand l'autre s'arrête.

Les agents sont écrits dans `~/Library/LaunchAgents/`, à partir des chemins de ce Mac : ils ne sont jamais versionnés. Ils ne contiennent aucun secret : le lanceur (`run.sh`) charge les mêmes fichiers `.env*` que les scripts npm.

## Ouvrir la page

```bash
npm run page
```

Le serveur ne montre plus le lien de la page dans la console. Il l'écrit dans un fichier que toi seul peux lire, et `npm run page` l'ouvre dans le navigateur. Le jeton change à chaque démarrage du serveur : une page ouverte avant un redémarrage se rouvre par `npm run page`.

## Les journaux de la console

`~/Library/Logs/cenacle/<programme>.log` : des lignes d'état et des noms d'erreur, jamais un contenu de mail ni le jeton de la page. Chacun est vidé au démarrage au-delà de 1 Mo.

```bash
tail -f ~/Library/Logs/cenacle/iris.log
```

## Ce qu'il faut régler de ton côté

Iris, le serveur et le bot ont besoin de la base ; Iris, du modèle. Sans eux, ils démarrent, échouent, et réessaient toutes les 30 s jusqu'à ce qu'ils soient là.

- **Docker Desktop** : Réglages → Général → « Start Docker Desktop when you sign in ».
- **LM Studio** : Réglages → activer le service au démarrage de session, avec le chargement du modèle à la demande (« Just-in-Time Model Loading »).

## Ce que ça ne règle pas

Tout ne tourne qu'une fois ta session ouverte (écran verrouillé : ça continue). Mac en veille, fermé ou absent : tout est en pause. Au retour, la relève suivante rattrape le courrier.
