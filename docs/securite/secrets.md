# Les secrets de Cénacle (phase 5, S1)

> Où vit chaque secret, qui le lit, et comment le sauvegarder et le restaurer.
> Aucune valeur ici : les noms seulement.

## Un fichier par famille

| Fichier | Contient | Chargé par |
|---|---|---|
| `.env` | Ce qui n'est pas secret (ports, modèle, mesure, clé publique de la page, identifiant Telegram autorisé) et le mot de passe applicatif de la base | Tous |
| `.env.owner` | Le mot de passe du **propriétaire** de la base : il peut tout défaire (déclencheurs, rôles) | `npm run db:migrate`, les tests, Docker Compose |
| `.env.mail` | Le mot de passe de la boîte, et `CENACLE_MAIL_KEY` (clés HMAC des adresses) | Iris, la page, l'exécuteur, les commandes de messagerie, Docker Compose |
| `.env.telegram` | Le jeton du bot | Iris, le bot |
| `.env.obs` | L'administrateur de Grafana | Docker Compose |
| `.env.page` | La clé privée de la page (ADR-0013) | La page seule |
| `.env.executor` | Le mot de passe du rôle de l'exécuteur (ADR-0013) | L'exécuteur, les migrations, les tests |

Tous sont ignorés par git et lisibles par moi seul (droits 600).

**Refus au démarrage** : Iris (boîte, Telegram), la page (boîte, clé privée), l'exécuteur (boîte, son rôle) et le bot (Telegram) refusent de démarrer s'ils trouvent un secret d'une autre famille. Le message nomme la variable, jamais sa valeur.

**Limite assumée** (ADR-0013) : sur un Mac à utilisateur unique, un programme qui tourne sous mon compte peut lire tous ces fichiers. La séparation protège contre une erreur ou une dépendance compromise **dans un processus**, pas contre la prise de mon compte macOS.

## Répartir un `.env` existant

```
npm run secrets:split
```

Le script montre ce qui part où (noms seulement), demande `OUI`, copie l'ancien `.env` dans `.env.avant-split` (600), puis écrit les fichiers. Il refuse si une variable est déjà dans son fichier cible. Supprimer `.env.avant-split` une fois que tout tourne, **après** une sauvegarde.

## Sauvegarder

```
npm run secrets:backup -- --out /Volumes/CLE/cenacle-secrets
```

Une archive chiffrée (scrypt et AES-256-GCM) de `.env` et de tous les fichiers ci-dessus. La phrase de passe (12 caractères au moins) est demandée deux fois, jamais affichée, jamais gardée. À ranger **loin du Mac**, et à refaire à chaque changement de secret.

## Restaurer

```
npm run secrets:restore -- --from /Volumes/CLE/cenacle-secrets [--into <dossier>]
```

Écrit les fichiers dans le dépôt (ou dans un autre dossier, une installation neuve par exemple), en 600, **jamais par-dessus un fichier existant** : en cas de doublon, rien n'est écrit. Une phrase de passe fausse ou une archive modifiée sont refusées, avec le même message.

Ce que la perte coûterait sans sauvegarde :
- `CENACLE_MAIL_KEY` : la mémoire des mails devient illisible ; il faut la vider (elle se relit) et la **liste d'opposition** (C3) devient inutilisable : les personnes opposées seraient relues. C'est la perte la plus grave.
- La clé privée de la page : les acceptations pas encore envoyées échouent ; en tirer une nouvelle (`npm run keys:accept`).
- Les mots de passe de la base : se remettent par une migration ; celui de la boîte, chez l'hébergeur.

## La base de Cénacle n'est pas sauvegardée (décidé le 04/10)

La mémoire des mails se relit depuis la boîte, l'historique des propositions est purgé à 90 jours, le journal ne contient aucune donnée de personne. Ne pas sauvegarder la base évite d'avoir à faire suivre les purges et les effacements (C1, C3) dans des copies. La liste d'opposition, elle, ne doit pas se perdre : elle est dans la base. **À reconsidérer** si la base devenait la seule trace d'une opposition (elle l'est) : voir les points ouverts du registre.
