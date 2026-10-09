# ADR-0019 — Le serveur, le bot et la page lancés par launchd ; le jeton de la page ne passe plus par la console

**Statut** : acceptée (2026-10-09) — étend l'ADR-0018

## Contexte

L'ADR-0018 a confié Iris à `launchd`. Le serveur de la page, le bot Telegram et la page elle-même (le serveur Vite) se lancent encore à la main : après un redémarrage du Mac, Iris repart, mais ni la page ni Telegram ne répondent tant que je ne les relance pas.

Trois différences avec Iris :

- **Le jeton de la page** : le serveur tire un jeton à chaque démarrage et l'**affichait dans la console**. Sous `launchd`, il n'y a plus de terminal, et la console est un fichier de journal : le jeton s'y retrouverait en clair, et y resterait.
- **Le bot** : Telegram refuse deux programmes qui l'interrogent en même temps (erreur 409). Un second bot planterait, et serait relancé toutes les 30 s.
- **La page** n'a pas de secret, mais sans elle le serveur ne sert à rien.

## Décision

1. **Le serveur, le bot et la page** sont lancés par `launchd`, comme Iris (ADR-0018) : à l'ouverture de session, relancés seulement après un plantage, jamais après Ctrl+C ou `SIGTERM`, qu'ils traitent désormais comme un arrêt propre. `launchd` attend 40 s avant de forcer un arrêt : le bot termine son interrogation en cours (25 s au plus).
2. **Le jeton n'est plus jamais écrit dans la console.** Une fois son port ouvert — jamais avant —, le serveur écrit le lien de la page dans un fichier que je suis seul à pouvoir lire (`~/Library/Application Support/cenacle/page-url`, droits 0600, dossier 0700), par écriture atomique. Il l'efface à l'arrêt propre, s'il est toujours le sien. **`npm run page`** l'ouvre dans le navigateur sans l'afficher, et refuse un fichier absent, qui n'est pas à moi, lisible par d'autres, lien symbolique, trop long, ou dont le contenu n'est pas exactement un lien vers la page locale. Le jeton reste dans le fragment de l'adresse (`#jeton=`), jamais envoyé à un serveur.
3. **Un seul serveur et un seul bot à la fois**, par le verrou de l'ADR-0018 (`server`, `bot`) : un second sort avec le code 75, et celui de `launchd` prend le relais quand le premier s'arrête. Un serveur refusé n'écrit jamais de lien : il ne remplace pas celui du serveur qui tourne. La page n'a pas de verrou : son port fixe (`strictPort`) suffit.
4. **Une seule commande** : `npm run service -- install|uninstall|status iris|server|bot|web|all` ; `npm run iris:service` reste, pour Iris seule. Le lanceur charge exactement les fichiers `.env*` des scripts npm de chaque programme ; l'installeur ne charge aucun secret.
5. **La page tourne avec le serveur de développement Vite** (option A du 09/10), comme lorsque je la lance à la main.

## Conséquences

- Après un redémarrage du Mac et l'ouverture de ma session, tout repart : base, modèle, Iris, serveur, bot, page. `npm run page` suffit pour ouvrir la page.
- Un nouveau jeton à chaque démarrage du serveur : une page ouverte avant un redémarrage doit être rouverte par `npm run page`.
- Un serveur de développement tourne en permanence, sur 127.0.0.1 seulement.

## Options écartées

- **Garder le jeton dans la console** : il serait écrit, en clair, dans un journal qui dure.
- **Un jeton fixe, stocké dans un `.env`** : il ne changerait jamais, et vivrait aussi longtemps que le fichier ; un jeton par démarrage limite sa durée de vie.
- **Option B — le serveur de l'API sert lui-même la page compilée** : un seul programme et un seul port, mais la protection par l'en-tête `Host` et l'origine est à revoir ; à décider dans un ADR à part.
