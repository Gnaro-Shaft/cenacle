# ADR-0037 — La page compilée, servie par le serveur de l'API

**Statut** : proposée (2026-11-13) — remplacerait le point 5 de l'ADR-0019

## Contexte

L'ADR-0019 a fait tourner la page avec le **serveur de développement Vite** (option A du 09/10), sur `127.0.0.1:5173`, lancé par `launchd`. L'option B — le serveur de l'API sert lui-même la page compilée — avait été écartée « à décider dans un ADR à part », parce que la protection par l'en-tête `Host` et par l'origine était à revoir.

L'audit du 13/11 (lot C) l'a relevé, et le lot B l'a montré le jour même :

- **Deux versions à la fois.** Après la fusion du lot B, Vite a rechargé la nouvelle page à chaud, alors que le serveur de l'API tournait encore sur l'ancien code : la page affichait « undefined minute » tant que je n'avais pas redémarré le serveur. La page et l'API ne se mettent pas à jour ensemble.
- **Un outil de développement en service permanent.** Le serveur de Vite sert les sources, recompile à la volée, garde une connexion de rechargement à chaud ouverte, et dépend de tout l'outillage de développement. Il est fait pour le poste du développeur, pas pour tourner nuit et jour. Plusieurs failles publiées l'ont visé (lecture de fichiers hors du dossier servi).
- **Deux programmes, deux ports, deux journaux** pour une seule page.

## Décision

1. **La page est compilée** (`vite build`) dans `apps/web/dist/`, ignoré par git.
2. **Le serveur de l'API la sert lui-même**, sur son port (`127.0.0.1:8787`) : les fichiers de `dist/` à la racine, l'API sous `/api`, comme aujourd'hui. Les fichiers de la page ne contiennent aucun secret et ne demandent pas le jeton ; l'API le demande toujours.
3. **La page et l'API ont toujours la même version** : le lanceur (`run.sh server`) compile la page avant de démarrer le serveur. Un `git pull` suivi d'un redémarrage du serveur suffit ; une page compilée qui manque ou date d'avant les sources n'est jamais servie (le serveur refuse de démarrer et le dit en une ligne).
4. **La garde** (`guard.ts`) reste la même, avec l'origine de la page devenue celle de l'API : `Host` limité aux noms de la machine sur le port 8787, origine `http://127.0.0.1:8787` (et `localhost`) pour agir, jeton dans l'en-tête. La page et l'API ont la même origine : plus aucune requête d'une origine à l'autre.
5. **Des en-têtes de sécurité stricts**, possibles maintenant que rien n'est généré à la volée : `Content-Security-Policy` (`default-src 'self'`, aucun script en ligne, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, et `Cache-Control: no-store` pour `index.html`.
6. **Le lien de la page** devient `http://127.0.0.1:8787/#jeton=…` : `page-url.ts` et `npm run page` n'acceptent plus que celui-là.
7. **L'agent `launchd` de la page (`org.cenacle.web`) est retiré.** `npm run web` reste, pour développer à la main sur 5173, avec le rechargement à chaud ; la garde accepte alors aussi cette origine, en développement seulement (`CENACLE_WEB_DEV=1`), jamais par défaut.

## Conséquences

- Un programme, un port, un journal de moins. Plus d'outil de développement en service.
- Plus de décalage de version entre la page et l'API.
- Le démarrage du serveur prend quelques secondes de plus (la compilation).
- Plus de rechargement à chaud en service : une modification de la page demande un redémarrage du serveur (comme une modification de l'API aujourd'hui).
- Le lien de la page change une fois : la page ouverte avant la bascule se rouvre par `npm run page`.
- Travail : servir `dist/` dans `app.ts` (Hono, `serveStatic`), compiler dans `run.sh`, changer l'origine dans `guard.ts` et le lien dans `page-url.ts`, retirer `web` de l'installeur, les en-têtes, les tests (dont : aucun fichier hors de `dist/` n'est servi, un `Host` étranger est refusé même pour un fichier, la page sert sans jeton mais l'API non).

## Options écartées

- **Garder le serveur de développement Vite** (l'existant) : les trois défauts du contexte restent.
- **`vite preview`** : sert bien la page compilée, mais reste un second serveur sur un second port, et Vite le présente comme un aperçu, pas comme un serveur de service.
- **Un serveur de fichiers à part** (Caddy, nginx) : une dépendance et un programme de plus, pour ce que le serveur de l'API fait en quelques lignes.
- **Compiler à la main** (`npm run web:build`) plutôt qu'au démarrage : un oubli remet deux versions en service ; c'est le défaut que l'on corrige.
