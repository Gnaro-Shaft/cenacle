# ADR-0009 — Le registre des traitements est un fichier que le code applique

**Statut** : acceptée (2026-10-02) — reprise de l'ADR « Le Cadre » de Legion

## Décision

- Un fichier déclaratif versionné (`cadre.toml`, réel hors du dépôt, exemple versionné) déclare **chaque traitement** :
  - identifiant, finalité, base légale ;
  - catégories de données, durée de conservation ;
  - sources couvertes ;
  - réception éventuelle de données de tiers.
- **Refus par défaut** :
  - une source qui n'est couverte par aucun traitement **n'est pas lue** ;
  - une mention manquante fait **échouer le démarrage**.
- Chaque fait retenu **porte son traitement**. La purge applique à chacun sa durée.
- **Minimisation** :
  - on ne stocke **pas les corps** de mails : on les relit à la source quand il faut ;
  - de l'expéditeur, on garde ce que la finalité exige ;
  - l'identifiant de message est l'UID IMAP, jamais le `Message-ID`, qui révèle le domaine de l'expéditeur ;
  - la lecture se fait en `readonly` avec `BODY.PEEK`, sans marquer les messages comme lus.
- **Article 9 RGPD** : un plancher déterministe (liste fermée) écarte avant toute lecture ce qui révèle une catégorie particulière.
- **Ordre juridique avant l'ordre technique** : la mention d'information est publiée **avant** de lire une vraie boîte.
- **Aucun traitement de données réelles** tant que les boîtes de test suffisent (ADR-0010).

## Note

Ce document n'est pas un avis juridique. Le cadre réglementaire visé est le RGPD, l'AI Act (usage professionnel en tant que déployeur ; pas de système à haut risque) et le Data Act (portabilité : tout est conteneurisé et exportable).
