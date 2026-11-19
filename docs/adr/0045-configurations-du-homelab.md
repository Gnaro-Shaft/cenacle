# ADR-0045 — Les configurations du homelab : rapatriées de Legion, à l'identique, sans vrai nom

**Statut** : acceptée (2026-11-19) — reprend ce que le dossier `deploiement/` de Legion porte pour le homelab, sans ADR de Legion pour la plupart (seuls leurs `LISEZ-MOI.md`) ; s'appuie sur l'ADR-0043 (la veille des sauvegardes lit leurs verdicts) et l'ADR-0040 (l'arrêt de Legion, palier R4)

## Contexte

Cénacle remplace Legion. Avant d'archiver le dépôt de Legion, ce qui n'est **pas** Legion doit en sortir : son dossier `deploiement/` porte aussi la configuration de serveurs qui servent le homelab, et qui doivent lui survivre. Inventaire du 19/11, fait en lecture seule, sans ouvrir la configuration réelle de Legion :

| Ensemble | Ce qu'il fait | Où il tourne | Écrit dans Legion |
|---|---|---|---|
| `copie-dumps` | Sortir les sauvegardes `vzdump` du disque du nœud qui les produit, et les ramener ; verdict `copie-dumps` | le nœud de sauvegarde, et un nœud de la grappe pour le retour | ADR-024 ; script de 352 lignes, deux paires d'unités, deux surcharges, quatre essais en bash |
| `sauvegardes` | Constater que la tâche `vzdump` a eu lieu et réussi (le canal de courriel de Proxmox n'a jamais fonctionné) ; verdict `veiller-sauvegardes` | le nœud de sauvegarde | ADR-025 ; Python, bibliothèque standard seule ; ses tests dans `tests/` de Legion (pytest) |
| `grappe` | `attendre-la-grappe` (les trois veilleurs de sauvegarde l'appellent avant de juger), la remise en route d'une carte réseau sur un nœud, trois scripts d'administration de Proxmox | les nœuds de la grappe | `LISEZ-MOI.md` seul |
| `fail2ban` | `jail.local` — une jail qui lit le journal de systemd, faute de `/var/log/auth.log` sur Debian 12 | les deux VPS | `LISEZ-MOI.md` seul |
| `redemarrage-auto` | Redémarrer à 03:30 UTC quand un correctif l'exige | le VPS du site public | `LISEZ-MOI.md` seul |
| `mnemo` | Surcharges de Mnemo et d'Ollama, fermés au réseau local | la machine de Legion | `LISEZ-MOI.md` seul ; Mnemo n'est pas un projet de Legion |

Le reste du dossier s'arrête avec Legion : ses unités, `porter-le-code`, `attente`, `rappels`, le veilleur, `copie-bases` (ADR-0043, point 5) et sa ronde.

Ces fichiers portent de **vrais noms** — de machines, d'invités, de réseau — en dur, dans les scripts comme dans les unités : la charte de Cénacle l'interdit dans le dépôt.

## Décision

1. **Dans Cénacle, sous `deploy/homelab/<ensemble>/`** (*choisi le 19/11*). Cénacle lit déjà leurs verdicts (ADR-0043) : l'écrivain à côté du lecteur, leur format commun s'éprouve d'un bout à l'autre. Et ils gagnent les règles du dépôt : le hook des vrais noms et des secrets, 400 lignes au plus, des tests adversariaux, la CI.

2. **À l'identique d'abord.** Le déménagement ne change **aucun comportement** : mêmes chemins sur les serveurs, mêmes noms d'unités, mêmes heures, même format de verdict, octet pour octet (un test compare les verdicts de l'ancien et du nouveau sur les mêmes entrées, dans un Debian jetable). Les améliorations viennent après, chacune par sa PR. Renommer ce qui porte « legion » sur les serveurs n'est pas nécessaire et n'est pas fait.

3. **Aucun vrai nom dans le dépôt.** Ce qui en porte un passe dans **un fichier de configuration sur le serveur**, non versionné, écrit par moi d'après un exemple fictif versionné (`*.exemple.conf`), lu par le script ; une valeur absente ou hors de forme fait refuser le script, et dire laquelle. Les commentaires parlent de rôles (« le nœud de sauvegarde »), jamais de noms. Poser cette configuration est **la seule étape nouvelle** au déploiement, et elle précède la pose des scripts.

4. **Éprouvés comme le reste.** Les essais en bash de Legion deviennent des tests vitest, dans un Debian jetable comme ceux du minuteur de la copie (B1c) ; les tests pytest de `veiller-les-sauvegardes` deviennent des tests vitest qui lancent le vrai script avec `python3` (il n'utilise que la bibliothèque standard). Chaque ensemble ajoute ses `*.adversarial.test.ts` : configuration absente ou fausse, verdict inchangé, et ce que ses `LISEZ-MOI` décrivent comme pièges (la grappe qu'on vient de rejoindre, la jail qui ne lit rien).

5. **Mnemo n'est pas du homelab** : ses surcharges iraient dans le dépôt de Mnemo, s'il en avait un. *Tranché le 19/11* : aucun dépôt de Mnemo sur le Mac — elles vont dans `deploy/homelab/mnemo/`, au même régime ; elles en sortiront si Mnemo prend un dépôt à lui.

6. **Le conflit du VPS du site public.** Le redémarrage automatique que Legion y a posé (`Automatic-Reboot "true"`) fait refuser, toujours, le bouton « mises à jour de sécurité » de Cénacle (`cenacle-maj-securite` exige qu'aucun redémarrage ne se fasse seul). **Proposé** : garder le redémarrage automatique sur ce VPS — `unattended-upgrades` y installe déjà les correctifs, et un noyau corrigé se charge la nuit, sans moi — et ne pas lui déclarer ce bouton dans `serveurs.local.toml`. L'autre voie : retirer le redémarrage automatique et passer par le bouton de redémarrage. *Tranché le 19/11 : la proposition* — le redémarrage automatique reste, le bouton n'est pas déclaré pour ce VPS.

7. **Rien ne change sur un serveur sans moi.** Chaque ensemble se déploie de ma main (`rsync`, puis son installateur ou la copie des fichiers, comme `deploy/serveurs/`), un à la fois ; la ronde et les verdicts disent s'il tourne. Les copies dans le dépôt de Legion restent jusqu'à son archivage, marquées « déménagé dans Cénacle » dans leur `LISEZ-MOI`.

8. **Aucune donnée de personne, aucune IA, aucun tiers nouveau.** Des sauvegardes de machines, des journaux de connexion (fail2ban : des adresses IP d'inconnus, sur le VPS, comme aujourd'hui) — rien n'en remonte au Mac que des verdicts sans motif.

## Paliers

- **H0** — cet ADR, pour relecture.
- **H1** — la chaîne des sauvegardes : `copie-dumps`, `sauvegardes`, `attendre-la-grappe` (elles se tiennent : les veilleurs l'appellent, la veille de Cénacle lit leurs verdicts). Puis, après la bascule de la ronde (S2 de l'ADR-0043), la tâche `fr.gnaro.copie-dumps` du Mac s'arrête comme prévu.
- **H2** — le reste de `grappe` : la remise en route de la carte réseau, les scripts d'administration.
- **H3** — `fail2ban` et `redemarrage-auto`, selon le point 6.
- **H4** — `mnemo`, selon le point 5.
- Ensuite, à part : l'arrêt de Legion (R4 de l'ADR-0040), et le nettoyage de sa ronde sur chaque machine.

## Conséquences

- **Le dépôt de Legion peut être archivé** une fois H1 à H4 déployés : plus rien de ce qui doit survivre n'y vit seul.
- **Cénacle porte des scripts qu'il ne lance pas** : ils tournent sur les serveurs, sous systemd ; Cénacle les éprouve et lit leurs verdicts. C'est déjà le cas de `deploy/serveurs/`.
- **Une étape de plus au déploiement** : la configuration réelle de chaque ensemble, sur son serveur, à écrire une fois.
- **Plus de code éprouvé en CI** : des tests en Debian jetable, sautés là où Docker manque.

## Options écartées

- **Un dépôt à part pour le homelab** : plus étanche, mais sans les règles du dépôt (vrais noms, secrets, taille, tests) et sans le test d'un bout à l'autre des verdicts que Cénacle lit.
- **Les laisser dans Legion** et archiver quand même : la seule copie de ces scripts serait dans un dépôt mort, sans CI ; un nœud réinstallé n'aurait plus d'où les reprendre.
- **Améliorer en déménageant** : une différence de comportement deviendrait indiscernable d'une erreur de déménagement.
- **Garder les vrais noms dans les scripts, dépôt privé oblige** : la charte vaut quel que soit le dépôt, et le hook de commit les refuse.
