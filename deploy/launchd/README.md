# Cénacle lancé par launchd (ADR-0018, ADR-0019)

Iris, le serveur de la page, le bot Telegram, la page et le CTO démarrent à l'ouverture de session. Chacun repart s'il plante, jamais après `/stop`, Ctrl+C ou une déconnexion.

## Installer, vérifier, retirer

```bash
npm run service -- install all       # écrit et démarre les cinq agents launchd
npm run service -- status all        # chargé ? pid ? dernier code de sortie ?
npm run service -- uninstall all     # les arrête et les retire
```

On peut viser un seul programme : `iris`, `server`, `bot` ou `cto` à la place de `all`. La page n'est plus un programme à part : le serveur la compile à son démarrage et la sert lui-même (ADR-0037). `npm run iris:service -- install` fait la même chose pour Iris seule.

Avant d'installer, arrête ce que tu as lancé à la main (Ctrl+C). Si tu l'oublies, rien de grave : Iris, le serveur, le bot et le CTO n'acceptent qu'un exemplaire à la fois. Celui de launchd réessaie toutes les 30 s, puis prend le relais quand l'autre s'arrête.

Les agents sont écrits dans `~/Library/LaunchAgents/`, à partir des chemins de ce Mac : ils ne sont jamais versionnés. Ils ne contiennent aucun secret : le lanceur (`run.sh`) charge les mêmes fichiers `.env*` que les scripts npm.

## La ronde (ADR-0040)

```bash
npm run service -- install ronde
```

Toutes les 5 minutes, elle lit le bulletin de chaque machine de `parc.local.toml` avec sa clé de lecture, le juge avec les règles de Legion, et laisse deux fichiers dans `~/Library/Caches/`, réécrits d'un bloc à chaque passage : le verdict, au format de Legion (`fr.gnaro.cenacle.ronde.verdict`), et les dernières mesures pour la page (`fr.gnaro.cenacle.ronde.bulletins.json`). Aucun secret, aucun message : son journal (`ronde.log`) dit une ligne quand l'état change, et le nom de chaque machine qu'elle n'a pas pu lire. Sans elle, l'onglet Parc dit que la ronde n'a pas encore tourné, ou que ses mesures sont trop anciennes.

## La copie de la base (ADR-0044)

```bash
npm run service -- install copie
```

Chaque nuit à 2 h 30 (au réveil si le Mac dormait), elle exporte les données de quatre tables (`rappels`, `prospection_cartes`, `veille_articles`, `securite_constats`) par le rôle `cenacle_copie`, les chiffre avec `age` pour ta clé publique, et pousse le fichier chiffré sur le serveur de sauvegarde, par une clé qui n'y peut qu'écrire dans un dossier d'arrivée. Rien en clair ne touche le disque ; le fichier chiffré est effacé du Mac après l'envoi, réussi ou non. Son journal (`copie.log`) dit une ligne : la copie poussée et sa taille, ou pourquoi rien n'est parti.

Ce qu'il lui faut, de ton côté, une fois :

- `brew install age rsync` (le `rsync` de macOS, openrsync, n'est pas accepté) ;
- `.env.copie` (le mot de passe du rôle, déjà créé pour B1a) ;
- une paire de clés `age` : `age-keygen` **hors du Mac**, ou sur le Mac sans jamais l'écrire sur le disque ; la clé privée va dans ton gestionnaire de mots de passe et une copie hors ligne, **jamais** sur le Mac — sans elle, les copies sont illisibles ;
- la clé de poussée, sans phrase de passe (la copie part seule, la nuit) : `ssh-keygen -t ed25519 -N "" -C cenacle-copie -f ~/.ssh/cenacle/copie-pousser` ; sa ligne publique va sur le serveur (`deploy/serveurs/README.md`) ;
- `copie.local.toml`, d'après `copie.local.example.toml` : la clé publique `age1…`, le `known_hosts` de Cénacle avec l'empreinte du serveur, son adresse, le compte.

Tant que l'un manque, la copie ne part pas, et le journal dit lequel.

## Ouvrir la page

```bash
npm run page
```

Le serveur ne montre plus le lien de la page dans la console. Il l'écrit dans un fichier que toi seul peux lire, et `npm run page` l'ouvre dans le navigateur. Le jeton change à chaque démarrage du serveur : une page ouverte avant un redémarrage se rouvre par `npm run page`.

## Les journaux de la console

`~/Library/Logs/cenacle/<programme>.log` : des lignes d'état et des noms d'erreur, jamais un contenu de mail ni le jeton de la page. Chaque ligne écrite par nos programmes commence par la date et l'heure (pas celles qu'une bibliothèque écrit directement, comme la compilation de la page par vite). Un plantage tient en une ligne (`💥 plantage : TypeError (ECONNRESET)`), sans message ni trace : ils peuvent citer une adresse ou le chemin de ton dossier. Chaque journal est vidé au démarrage au-delà de 1 Mo.

```bash
tail -f ~/Library/Logs/cenacle/iris.log
```

## Ce qu'il faut régler de ton côté

Iris, le serveur et le bot ont besoin de la base ; Iris, du modèle. Sans eux, ils démarrent, échouent, et réessaient toutes les 30 s jusqu'à ce qu'ils soient là.

- **Docker Desktop** : Réglages → Général → « Start Docker Desktop when you sign in ».
- **Ollama** (ADR-0028) : l'application démarre avec la session (Réglages macOS → Général → Ouverture). Ses réglages tiennent dans un agent `launchd` à toi, qui fait `launchctl setenv` à l'ouverture de session : `OLLAMA_CONTEXT_LENGTH=262144`, `OLLAMA_KEEP_ALIVE=-1`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NO_CLOUD=1`. Vérifier : `ollama ps` montre le modèle de `LOCAL_MODEL_ID`, avec son contexte.

## Ce que ça ne règle pas

Tout ne tourne qu'une fois ta session ouverte (écran verrouillé : ça continue). Mac en veille, fermé ou absent : tout est en pause. Au retour, la relève suivante rattrape le courrier.

## Parler au CTO

Depuis la page (`npm run page`), le cadre « Demander au CTO », ou en ligne de commande :

```bash
npm run cto -- "ta question"
```

Les deux passent par le service du CTO, une question à la fois. Pas de donnée de client ni de contenu de mail dans les questions.
