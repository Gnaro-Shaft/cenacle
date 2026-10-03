# Phase 4 — Proposer et répondre (boîte de test)

**Objectif** : pour une relance due, Iris propose un brouillon de réponse ; je le lis, le corrige et l'accepte sur la page ; un exécuteur **sans IA** l'envoie. Iris n'a jamais le pouvoir d'envoyer (ADR-0004).
**Critère de sortie** : aucun envoi sans mon acceptation, aucun fait inventé dans un brouillon, sur le jeu de test et les pièges.

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **B0 — Le vérificateur de faits** | Sans IA : tout nombre, date, heure, montant, lien, adresse d'un brouillon doit exister dans le fil | `npm run draft:check` : 16/16 brouillons jugés comme attendu |
| **B0b — Les trames** | Mes réponses types, avec des cases typées par le code : code (`{prenom}`, `{objet}`), fil (`{creneau}`, `{sujet}`, `{date}` — vérifiées), à moi (`{delai}`… — jamais remplies par Iris) | `npm run trames:demo` |
| **B1 — Les propositions** | Table `proposals` : une proposition par mail, pour toujours ; cycle de vie et garde-fous tenus **par la base** ; texte effacé 7 jours après clôture | `npm run proposal` |
| **B2 — Iris rédige** | Choix de la trame **par vote** (6 ordres de la liste, 5 votes sur 6 requis, sinon rien n'est proposé) ; chaque mot d'une case du fil vient du fil | `npm run draft:vote` : 9/12 comme moi, 0 autre trame, 0 fait inventé |
| **B3 — Je valide** | Page : destinataire imposé (l'expéditeur, relu sur le serveur), alertes rouges, Accepter bloqué tant qu'il reste une case ; jeton tiré à chaque démarrage du serveur ; Telegram : « N brouillons à valider » | Modifier, accepter, annuler, refuser depuis la page |
| **B4 — L'exécuteur** | Programme à part, sans modèle : 2 min pour annuler, 20 envois par jour, revérifie au dernier moment (déjà répondu ? mail disparu ?), envoie au plus une fois, copie dans Envoyés | Réponse visible dans GreenMail, dans le bon fil |
| **B5 — Mesure** | Aucun chemin d'envoi sans acceptation (injection, double clic, rejeu, proposition caduque) ; banc d'invention | `npm run draft:bench` vert |

## Décisions (03/10)

- **Vouvoiement** ; ma signature et mes vraies trames restent **hors du dépôt** (`trames.local.toml`).
- **Trames d'abord** ; vote partagé ou « aucune » → **rien n'est proposé**, la relance reste à moi.
- **Destinataire** : toujours l'expéditeur du mail ; un Reply-To ailleurs est signalé et ignoré.
- **Page** : un jeton par démarrage du serveur ; actions refusées depuis une autre origine ou un autre nom d'hôte.
- **Exécuteur** : programme séparé d'Iris ; une copie de chaque envoi va dans Envoyés (sa seule écriture dans la boîte).
- **Phase 4 = boîte de test** : l'exécuteur n'écrit qu'au serveur de test de la machine, et seulement vers des domaines réservés aux tests (`.test`, `.example`). Personne de réel ne peut recevoir un mail.
