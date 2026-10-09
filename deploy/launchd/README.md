# Iris lancée par launchd (ADR-0018)

Iris démarre à l'ouverture de session et repart si elle plante, jamais après `/stop` ni Ctrl+C.

## Installer, vérifier, retirer

```bash
npm run iris:service -- install     # écrit et démarre l'agent launchd
npm run iris:service -- status      # chargé ? pid ? dernier code de sortie ?
npm run iris:service -- uninstall   # l'arrête et le retire
```

Avant d'installer, arrête l'Iris lancée à la main (Ctrl+C). Si tu l'oublies, rien de grave : celle de launchd est refusée (une seule Iris à la fois) et réessaie toutes les 30 s, puis prend le relais quand l'autre s'arrête.

L'agent est écrit dans `~/Library/LaunchAgents/`, à partir des chemins de ce Mac : il n'est jamais versionné. Il ne contient aucun secret : le lanceur (`run.sh`) charge les mêmes fichiers `.env*` que `npm run iris`.

## Le journal de la console

`~/Library/Logs/cenacle/iris.log` : des lignes d'état et des noms d'erreur, jamais un contenu de mail. Il est vidé au démarrage au-delà de 1 Mo.

```bash
tail -f ~/Library/Logs/cenacle/iris.log
```

## Ce qu'il faut régler de ton côté

Iris a besoin de la base et du modèle. Sans eux, elle démarre, échoue, et réessaie toutes les 30 s jusqu'à ce qu'ils soient là.

- **Docker Desktop** : Réglages → Général → « Start Docker Desktop when you sign in ».
- **LM Studio** : Réglages → activer le service au démarrage de session (« Run LLM server on login »), avec le modèle d'Iris chargé (ou chargé à la demande).

## Ce que ça ne règle pas

Mac en veille, fermé ou absent : Iris est en pause. Au retour, la relève suivante rattrape tout.
