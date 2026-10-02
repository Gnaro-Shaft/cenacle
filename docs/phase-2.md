# Phase 2 — Iris lit et range (boîte de test)

**Objectif** : Iris relève une boîte de test, range chaque mail dans une case (ADR-0007) et le montre sur la page — sans jamais toucher une vraie boîte.
**Critère de sortie** : un rapport chiffré (taux de bon rangement par case, part laissée en « À trier », 0 piège suivi), jugé suffisant par le propriétaire avant la phase 3 (alertes).

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **M0 — Branches et PR** | Règle GitHub : PR + CI verte (`check`, `secrets`) obligatoires sur `main` | Un push direct sur `main` est refusé ; une PR passe |
| **M1 — Les faux mails** | ~150 mails fictifs (`fixtures/mails.json`) avec leur vérité attendue : case, urgence, piège. Domaines réservés (`.example`, `.test`), personnes et sociétés inventées | Statistiques du jeu par case |
| **M2 — Le faux serveur** | GreenMail (IMAP + SMTP) en Docker, chargé avec le jeu | « 150 messages dans INBOX » |
| **M3 — Le facteur** | Lecture IMAP en lecture seule (`BODY.PEEK`), UID et domaine de l'expéditeur seulement, plafond de 500 par relève — jamais le contenu dans le journal ; `cadre.toml` déclare la source (ADR-0009) | Iris relève ; les mails restent non lus |
| **M4 — Les règles** | Rangement sans IA par domaine exact (ADR-0007) | « N rangés par règle, M restants » |
| **M5 — Le modèle range le reste** | Modèle local, sortie imposée (liste fermée), « À trier » en cas de doute ; pièges sans effet (ADR-0005) | Score par case, part « À trier », 0 piège suivi |
| **M6 — La page** | Compteurs par case dans la case d'Iris | Les compteurs bougent pendant le tri |
