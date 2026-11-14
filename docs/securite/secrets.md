# Les secrets de Cénacle (phase 5, S1)

> Où vit chaque secret, qui le lit, et comment le sauvegarder et le restaurer.
> Aucune valeur ici : les noms seulement.

## Un fichier par famille

| Fichier | Contient | Chargé par |
|---|---|---|
| `.env` | Ce qui n'est pas secret (ports, modèle, mesure, clé publique de la page, clé publique du bot, identifiant Telegram autorisé) et le mot de passe applicatif de la base | Tous |
| `.env.owner` | Le mot de passe du **propriétaire** de la base : il peut tout défaire dans la base de Cénacle (déclencheurs, rôles des programmes), mais n'est pas super-utilisateur (ADR-0038) : ni fichier du serveur, ni commande du système | `npm run db:migrate`, les tests, Docker Compose |
| `.env.admin` | Le mot de passe du **super-utilisateur** `cenacle_admin` (ADR-0038) : il peut tout, y compris dans le conteneur | **Aucun programme**, ni les migrations : Docker Compose seul, et moi à la main, rarement |
| `.env.mail` | Le mot de passe de la boîte, et `CENACLE_MAIL_KEY` (clés HMAC des adresses) | Iris, la page, l'exécuteur, les commandes de messagerie, Docker Compose |
| `.env.telegram` | Le jeton du bot | Iris, le bot, la veille du CTO, l'agent sécurité |
| `.env.obs` | L'administrateur de Grafana | Docker Compose |
| `.env.page` | La clé privée de la page (ADR-0013) | La page seule |
| `.env.bot` | La clé privée du bot, qui signe ma confirmation d'une action sur un serveur ou d'un plan (ADR-0036) | Le bot seul |
| `.env.proxmox` | Le jeton **en lecture seule** de la grappe Proxmox (`cenacle@pve`, rôle `PVEAuditor`, ADR-0039) : il voit la grappe, il ne peut rien y changer | Le serveur de la page seul |
| `.env.executor` | Le mot de passe du rôle de l'exécuteur (ADR-0013) | L'exécuteur, les migrations, les tests |
| `.env.sentinel` | Le jeton partagé avec la sentinelle (S2), qui authentifie les battements ; le VPS en garde la copie dans `/etc/cenacle-sentinel.env`, lisible par root seul | Iris, l'exécuteur |

Tous sont ignorés par git et lisibles par moi seul (droits 600).

**Le lien de la page** (ADR-0019) n'est pas un fichier `.env` mais il porte un secret : le serveur de la page écrit le lien et son jeton de session dans `~/Library/Application Support/cenacle/page-url` (droits 600, dossier 700), une fois son port ouvert, et l'efface à l'arrêt propre ; `npm run page` l'ouvre sans l'afficher. Le jeton change à chaque démarrage du serveur et n'apparaît jamais dans les journaux.

**Refus au démarrage** : Iris (boîte, Telegram, sentinelle), la page (boîte, clé privée), l'exécuteur (boîte, son rôle, sentinelle), le bot (Telegram, sa clé de confirmation), la veille du CTO (Telegram), l'agent sécurité (Telegram ; et, pour les PR de J6c, l'accès `gh` déjà installé sur le Mac, dans le trousseau, jamais dans un `.env`) et le service du CTO (aucune famille) refusent de démarrer s'ils trouvent un secret d'une autre famille. Le message nomme la variable, jamais sa valeur.

**Limite assumée** (ADR-0013) : sur un Mac à utilisateur unique, un programme qui tourne sous mon compte peut lire tous ces fichiers. La séparation protège contre une erreur ou une dépendance compromise **dans un processus**, pas contre la prise de mon compte macOS.

## Répartir un `.env` existant

```
npm run secrets:split
```

Le script montre ce qui part où (noms seulement), demande `OUI`, copie l'ancien `.env` dans `.env.avant-split` (600), puis écrit les fichiers. Il refuse si une variable est déjà dans son fichier cible. Supprimer `.env.avant-split` une fois que tout tourne, **après** une sauvegarde.

## Le propriétaire sans super-utilisateur (ADR-0038)

Une installation faite avant l'ADR-0038 a un `cenacle_owner` super-utilisateur. La bascule se fait une fois, **depuis le dossier principal du dépôt** (celui que les services lisent : dans un dossier de travail, `.env.owner` est un lien, et la commande refuse) :

```
npm run db:bascule -- --essai   # ce qu'elle ferait, rien n'est changé
npm run db:bascule              # la bascule
npm run db:migrate && npm test && npm run secrets:backup -- --out …
```

Elle sauvegarde d'abord la base (`pg_dump`) dans `~/Library/Application Support/cenacle/sauvegardes/` (fichier 600, dossier 700), puis renomme le super-utilisateur en `cenacle_admin` (son mot de passe passe dans `.env.admin`) et crée un nouveau `cenacle_owner`, avec un nouveau mot de passe dans `.env.owner`. L'ancien `.env.owner` reste dans `.env.owner.avant-bascule`. **Une fois la bascule vérifiée, supprimer la sauvegarde** (elle contient les données de la base) **et `.env.owner.avant-bascule`**. Si un programme tient un verrou plus de 5 s, la bascule est annulée et le dit : la relancer. Si son issue est incertaine (connexion perdue au moment de valider), rien n'est effacé : les nouveaux mots de passe restent dans `.env.owner.nouveau` et `.env.admin.nouveau`. Retour arrière : `npm run db:bascule -- --retour`.

## La grappe Proxmox, en lecture seule (ADR-0039)

Dans Proxmox (interface ou shell d'un nœud), une fois :

```
pveum user add cenacle@pve --comment "Cenacle, lecture seule"
pveum acl modify / --users cenacle@pve --roles PVEAuditor
pveum user token add cenacle@pve parc --privsep 1
pveum acl modify / --tokens 'cenacle@pve!parc' --roles PVEAuditor
```

La dernière commande affiche la valeur du jeton **une seule fois** : dans `.env.proxmox`, `CENACLE_PROXMOX_TOKEN=cenacle@pve!parc=<valeur>`. Puis copie l'autorité de la grappe (`/etc/pve/pve-root-ca.pem`, un certificat public, pas un secret) sur le Mac, et dans `.env` : `CENACLE_PROXMOX_CA=<chemin de ce fichier>` et `CENACLE_PROXMOX_NODES=<nom du nœud>@<adresse Tailscale>:8006,…` — le nom du nœud est celui que porte son certificat, vérifié à chaque appel. Redémarre le serveur de la page. **En cas de doute** : `pveum user token remove cenacle@pve parc`, et le jeton ne vaut plus rien.

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
- La clé privée du bot (ADR-0036) : supprimer `.env.bot`, en tirer une nouvelle (`npm run keys:confirm`), recopier la clé publique affichée dans `.env`, redémarrer le bot. Les confirmations pas encore exécutées sont refusées, et dites.
- Les mots de passe de la base : se remettent par une migration ; celui de la boîte, chez l'hébergeur.

## La base de Cénacle n'est pas sauvegardée (décidé le 04/10), sauf la liste d'opposition

La mémoire des mails se relit depuis la boîte, l'historique des propositions est purgé à 90 jours, le journal ne contient aucune donnée de personne. Ne pas sauvegarder la base évite d'avoir à faire suivre les purges et les effacements (C1, C3) dans des copies.

**La liste d'opposition fait exception** : sa perte ferait relire des personnes qui ont demandé l'effacement. Elle part dans la même archive chiffrée que les secrets (ses clés ne servent à rien sans `CENACLE_MAIL_KEY`, qui part avec elles) : `secrets:backup` la lit dans la base, et refuse de sauvegarder si la base est injoignable — une archive sans elle aurait l'air complète. `secrets:restore` la réinscrit (sans doublon) ; pour une installation neuve, une fois la base migrée : `npm run secrets:restore -- --from <fichier> --opposition-seule`. Après chaque effacement, `npm run personne` rappelle de refaire la sauvegarde. Une opposition retirée après la dernière sauvegarde reviendrait à la restauration : l'erreur va dans le sens le plus protecteur.
