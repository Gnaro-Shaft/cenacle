# ADR-0038 — Le propriétaire de la base n'est plus super-utilisateur

**Statut** : proposée (2026-11-13)

## Contexte

L'image officielle de Postgres crée `POSTGRES_USER` en **super-utilisateur**. Chez nous, c'est `cenacle_owner`, vérifié le 13/11 sur la base (Postgres 18) : `rolsuper`, `rolcreaterole`, `rolcreatedb`. Les programmes ne s'en servent pas — ils ont `cenacle_app` et `cenacle_executor`, bridés (ADR-0013) —, seules les migrations, les planchers de purge et les tests le chargent (`.env.owner`).

Un super-utilisateur peut tout, au-delà de la base : lire et écrire des fichiers du conteneur, lancer une commande du système (`COPY … TO PROGRAM`), ignorer toute règle. Le mot de passe de `.env.owner` qui fuirait donnerait donc un accès au conteneur, pas seulement aux tables. L'audit du 13/11 (lot A) l'a relevé.

## Décision

1. **Un administrateur à part, pour les seuls gestes rares** : `cenacle_admin`, super-utilisateur, son mot de passe dans `.env.admin` (une famille de secrets à elle, chargée par **aucun programme** ni par les migrations ; seulement par `npm run db:admin`, à la main, pour ce qui demande vraiment un super-utilisateur).
2. **`cenacle_owner` devient `NOSUPERUSER`**, en gardant ce dont les migrations et les tests ont besoin :
   - il reste propriétaire de la base, du schéma, des tables, des fonctions et des déclencheurs ;
   - `CREATEROLE`, avec l'option `ADMIN` sur `cenacle_app` et `cenacle_executor` (Postgres 16 et suivants : on ne gère que les rôles dont on est administrateur) ;
   - `CREATEDB`, pour que les tests créent et suppriment `cenacle_test`.
3. **La bascule, une fois, à la main**, avec le super-utilisateur actuel (`.env.owner`) : créer `cenacle_admin` ; donner à `cenacle_owner` l'option `ADMIN` sur les deux rôles ; `ALTER ROLE cenacle_owner NOSUPERUSER`. **Retour arrière** : avec `cenacle_admin`, `ALTER ROLE cenacle_owner SUPERUSER`.
4. **Une installation neuve** (`npm run setup`, D5) fait la même bascule juste après le premier `db:up`, puisque l'image crée toujours `POSTGRES_USER` en super-utilisateur.
5. **Vérifié par le code** : un test refuse que le rôle des migrations soit super-utilisateur, et un autre vérifie que `db:migrate`, `db:planchers` et la création de la base de test marchent sans.

## Conséquences

- Un `.env.owner` qui fuit ne donne plus accès au conteneur : seulement aux objets de Cénacle, comme leur propriétaire.
- Un secret de plus (`.env.admin`), à sauvegarder chiffré avec les autres (`secrets:backup`), qu'aucun programme ne charge.
- Le propriétaire peut toujours modifier ses propres tables, y compris désactiver un déclencheur : cette ADR ferme l'accès au système, pas le pouvoir du propriétaire sur Cénacle (les rôles séparés de l'ADR-0013 restent la défense des programmes).
- À vérifier avant de coder : que les migrations existantes ne demandent aucun droit de super-utilisateur (extensions, `ALTER SYSTEM`, fonctions en langage non sûr) — la liste des fichiers SQL sera relue.

## Options écartées

- **Garder le super-utilisateur, et l'inscrire comme risque accepté** : le moins de travail, mais le mot de passe des migrations reste une clé du conteneur.
- **Un rôle de migration distinct du propriétaire** : plus fin, mais il faudrait transférer la propriété de chaque objet ; pas de gain tant que les programmes n'ont jamais ce rôle.
- **Changer `POSTGRES_USER` dans `compose.yaml`** : sans effet sur un volume existant, l'image ne le lit qu'à la première création.
