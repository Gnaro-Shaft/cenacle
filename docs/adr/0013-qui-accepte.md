# ADR-0013 — Seule la page peut accepter : acceptation signée, états clos définitifs

**Statut** : acceptée (2026-10-03) — complète l'ADR-0004

## Contexte

L'ADR-0004 veut que l'agent propose, que je valide, et qu'un exécuteur sans IA agisse. Aujourd'hui, cette séparation est tenue **par le code**, pas par la base :

- tous les programmes (Iris, la page, l'exécuteur, la CLI) se connectent avec **le même rôle** `cenacle_app`, qui a le droit `UPDATE` sur `proposals` ;
- les contraintes de la table vérifient qu'une ligne est **cohérente**, pas **qui** l'a changée ni **d'où** elle vient ;
- tous les programmes chargent le même `.env`, donc les mêmes secrets.

Constaté le 03/10 sur la base de test, avec le seul rôle applicatif :

1. une proposition passe de « en attente » à « acceptée » **sans la page** ;
2. le **texte** d'une proposition acceptée est changé après mon acceptation, et c'est ce texte que l'exécuteur enverrait ;
3. une proposition **annulée** est rouverte en « acceptée ».

Le banc B5 (`npm run draft:bench`) **détecte** un envoi qui n'a pas été accepté sur la page. Mais rien ne l'**empêche**. Le modèle n'a aucun outil : le risque vient d'un défaut du code d'Iris, d'une dépendance compromise dans un de ses processus, ou d'une erreur future. Avant la phase 5 (vraie boîte, vrais destinataires), la garantie doit être tenue par construction.

## Décision

1. **L'acceptation est signée par la page.** Au clic « Accepter », le serveur de la page signe en **Ed25519** le message suivant :
   `cenacle-accept-v1 · id · mail_uid_validity · mail_uid · SHA-256 du texte · decided_at`.
   La signature est rangée dans une nouvelle colonne `acceptance_sig`.
   - La **clé privée** n'est donnée qu'au serveur de la page.
   - La **clé publique** est dans la configuration de l'exécuteur.
   - Iris n'a ni l'une ni l'autre.
2. **L'exécuteur vérifie avant de prendre la proposition.** Sans signature valide pour *cette* proposition et *ce* texte, il ne l'envoie pas : il la marque `failed`, l'écrit au journal (`send.unsigned`, sans le texte) et me prévient. La signature lie le texte, donc un texte changé après l'acceptation n'est jamais envoyé.
3. **Les états clos sont définitifs, par la base.** Un déclencheur refuse toute modification d'une proposition close (envoyée, échouée, refusée, caduque, annulée, écartée), sauf l'effacement du texte à 7 jours. Un déclencheur refuse aussi tout changement du texte hors de l'état « en attente ». La réouverture d'une annulation devient impossible, quel que soit le rôle.
4. **Un fichier d'environnement par programme.** Chaque programme ne charge que ses propres secrets :
   - Iris : la base et la lecture IMAP ;
   - la page : la base et la clé privée ;
   - l'exécuteur : la base, SMTP et la clé publique.
   `.env.example` est découpé en conséquence. C'est aussi ce que l'ADR-0004 promettait déjà (« seul l'exécuteur détient les identifiants d'envoi ») et qui n'est pas vrai aujourd'hui.
5. **Tests adversariaux exigés** :
   - une acceptation écrite sans la page n'est pas envoyée ;
   - un texte changé après l'acceptation n'est pas envoyé ;
   - la signature d'une proposition, recopiée sur une autre, est refusée ;
   - une annulation ne peut pas être rouverte, même en SQL direct ;
   - au banc, le mutant « Iris accepte elle-même » doit être **empêché** (0 envoi), et plus seulement détecté.

## Conséquences

- La garantie « seule la page accepte » ne dépend plus du code d'Iris, ni du rôle en base, ni du contenu de la table : elle dépend de **qui détient la clé privée**.
- **Limite assumée** : sur un Mac à utilisateur unique, un programme qui tourne sous mon compte peut lire tous les fichiers de ce compte, clé privée comprise. La décision protège contre un défaut ou une dépendance compromise **dans un processus** (ses variables d'environnement, sa connexion). Elle ne protège pas contre la prise de contrôle de mon compte macOS : un tel attaquant aurait de toute façon mes identifiants de messagerie. Séparer les programmes en **utilisateurs macOS distincts** est à décider avec le déploiement de la phase 5.
- **Rotation de la clé** : une proposition acceptée avec l'ancienne clé, et pas encore envoyée, échoue. Cela couvre au plus 2 minutes de fenêtre, la rotation est rare et l'échec est visible. Procédure à écrire avec les autres secrets (phase 5).
- **Identifiants de messagerie** : chez beaucoup de fournisseurs, lire (IMAP) et envoyer (SMTP) utilisent le même mot de passe. Iris pourrait alors, en théorie, envoyer elle-même. À vérifier pour la vraie boîte : mot de passe d'application en lecture seule si le fournisseur le permet. Sinon, c'est un risque à inscrire.
- **Aucune donnée personnelle nouvelle** : la signature porte sur une empreinte du texte, jamais sur le texte. Elle peut rester après l'effacement du texte à 7 jours.
- Travail : une migration (colonne, déclencheurs), la signature dans `proposals-service`, la vérification dans `executeDue`, le découpage de l'environnement, les tests. Cela fait un jalon, à placer avant toute vraie boîte.

## Alternatives écartées

- **Des rôles séparés en base** (une fonction `SECURITY DEFINER` par transition, et un rôle par programme qui n'a le droit d'exécuter que les siennes). C'est aussi fort pour savoir « qui » accepte, à condition que les mots de passe soient séparés. Mais cela ne lie pas le texte accepté, cela demande de réécrire le magasin de propositions en fonctions SQL, et le propriétaire de la base (migrations) garde tout pouvoir. C'est un complément possible plus tard, pas la mesure principale.
- **Une signature HMAC partagée** entre la page et l'exécuteur. L'exécuteur, détenant la clé, pourrait fabriquer une acceptation. Ed25519 ne coûte rien de plus (`node:crypto`) et ne donne à l'exécuteur que le pouvoir de vérifier.
- **Une clé tirée à chaque démarrage de la page**, comme le jeton. L'exécuteur devrait apprendre chaque nouvelle clé publique par la base, où Iris pourrait glisser la sienne.
- **Le statu quo, avec la détection par le banc.** Le banc mesure le code du dépôt, pas ce qui tourne réellement, et constater après coup un envoi déjà parti ne protège personne.
