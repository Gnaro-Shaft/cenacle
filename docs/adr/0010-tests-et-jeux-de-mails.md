# ADR-0010 — Boîtes de test, jeu de mails fictifs, tests adversariaux

**Statut** : acceptée (2026-10-02)

## Décision

- **Deux boîtes de test, aucune donnée réelle pendant la construction** :
  1. un **serveur de mail factice en Docker** (IMAP + SMTP, de type GreenMail ; licence et maintenance à vérifier au choix), pour les tests automatiques, la CI et la **démo publique** ;
  2. une **vraie boîte de test** sur un domaine de l'auteur, pour valider le comportement face à un vrai serveur avant toute vraie boîte.
- **Un jeu d'environ 150 mails fictifs**, versionné et publiable : clients et prospects, administratif, bruit, urgents, et **mails pièges** (injections d'instructions, liens douteux, HTML malveillant, faux expéditeurs, demandes de transfert).
- **Mesures publiées** pour chaque lot : taux de bon classement par case, part en « À trier », 0 envoi sans validation, 0 fuite, 0 invention de fait dans les brouillons.
- **Tests adversariaux obligatoires** (charte, règle 8) : un lot sans eux n'est pas livré.
