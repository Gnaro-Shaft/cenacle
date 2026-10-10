# ADR-0023 — Le verrou d'instance est surveillé, et repris après une coupure de la base

**Statut** : acceptée (2026-10-10) — complète l'ADR-0018

## Contexte

L'ADR-0018 donne à chaque programme de longue durée (Iris, le bot, le serveur de la page, le CTO) un verrou consultatif PostgreSQL, pris au démarrage et tenu « toute sa vie » : un second exemplaire refuse de démarrer (code 75).

Mais le verrou appartient à une session PostgreSQL. Quand la base redémarre, ou que la connexion est coupée, la session meurt et le verrou tombe, sans que le programme le sache. Il continue sans verrou : un second exemplaire lancé à la main démarrerait alors sans être refusé — deux Iris feraient chaque passe et chaque alerte deux fois, deux bots se disputeraient Telegram (409). L'essai réel de la panne de base du bot (2026-10-10) a fait tomber les quatre verrous.

En cherchant comment le surveiller, une sonde a montré un piège de la bibliothèque `postgres` (3.4.9) : une connexion **réservée** d'un pool, interrogée quelque temps après la coupure de sa session, ne répond jamais et lève une erreur que rien ne peut attraper (`Cannot read properties of null`), ce qui fait planter le programme. Le code d'avant y tombait déjà : après un redémarrage de la base, l'arrêt propre d'un service, qui rend son verrou, plantait.

## Décision

1. **Le verrou est tenu sur un client à lui**, d'une seule connexion, jamais recyclée (`connectLockAsApp`) — plus sur une connexion réservée d'un pool. Après une coupure, la bibliothèque rouvre seule une session, comme pour toute requête. Le recyclage par défaut (une connexion remplacée après 30 à 60 min) est désactivé : il lâcherait le verrou. `holdSingleInstance` refuse un pool de plusieurs connexions.
2. **Le verrou est contrôlé toutes les 30 s** (`watchOrQuit`), en une seule requête, donc sur une seule session :
   - toujours tenu : rien ;
   - perdu mais libre : repris, et une ligne le dit ;
   - perdu et pris par un autre exemplaire : une ligne, puis sortie avec le code 75, comme au démarrage — seul celui qui tient le verrou continue ;
   - base injoignable : rien, on réessaie au contrôle suivant — personne d'autre ne peut prendre le verrou sans la même base.
3. **Jamais réentrant** : un client qui tient déjà le verrou ne le reprend pas (un verrou consultatif pris deux fois sur une session demanderait deux libérations).

## Conséquences

- Un second exemplaire ne peut se glisser que dans les 30 s qui suivent le retour de la base ; s'il y parvient, c'est le premier qui s'efface.
- Une sortie 75 interrompt le travail en cours : tout repart du journal, comme après un plantage (ADR-0018).
- Une requête de plus toutes les 30 s par service, sur sa propre connexion.
- Le piège de la bibliothèque `postgres` reste à signaler à ses auteurs ; tant qu'il existe, aucune connexion réservée ne doit être tenue longtemps.

## Options écartées

- **Garder la connexion réservée et borner chaque requête par un délai** : la requête bloquée fuit, et l'erreur non attrapée fait planter quand même.
- **Sortir dès que le verrou est perdu, et laisser launchd relancer** : au moins 30 s d'arrêt à chaque coupure de la base, et une boucle de relances tant qu'elle est absente.
- **Un contrôle plus fréquent** : la fenêtre se réduit, mais chaque service interroge la base d'autant plus souvent, pour un risque déjà faible sous launchd.
