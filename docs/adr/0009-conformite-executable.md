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

## Révisions

- **Révision du 2026-11-13 — la durée de conservation oblige aussi la base.** Les deux fonctions de purge (`purge_events`, `purge_proposals`) tournent avec les droits du propriétaire pour un rôle applicatif qui ne peut rien effacer seul ; elles ne refusaient qu'une date future. Un seul appel, `select purge_events(now())`, vidait donc tout le journal depuis n'importe quel programme tenant le mot de passe applicatif (audit du 13/11) — la règle 4 de la charte ne tenait que par le code d'Iris. Désormais la base détient un **plancher** par purge (table `purge_planchers`, migration 032) : `journal_jours` et `propositions_jours`, recopiés du cadre par `npm run db:migrate` avec les droits du propriétaire. Une purge dont la date est plus récente que son plancher est refusée, à une heure près (deux horloges : celle des programmes, celle du conteneur de la base). Sans plancher posé, toute purge est refusée. Le rôle applicatif ne peut ni lire ni changer un plancher. **Conséquence** : changer `journal_jours` ou `propositions_jours` dans le cadre demande un `npm run db:migrate` ; sinon la purge d'Iris échoue, et le dit (`PurgeFloorError`). **Limite** : le propriétaire de la base peut toujours tout défaire, comme avant.

## Note

Ce document n'est pas un avis juridique. Le cadre réglementaire visé est le RGPD, l'AI Act (usage professionnel en tant que déployeur ; pas de système à haut risque) et le Data Act (portabilité : tout est conteneurisé et exportable).
