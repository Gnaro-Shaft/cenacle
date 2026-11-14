# ADR-0038 — Le propriétaire de la base n'est plus super-utilisateur

**Statut** : acceptée (2026-11-14), amendée le même jour après essai (voir « Ce que l'essai a montré »)

## Contexte

L'image officielle de Postgres crée `POSTGRES_USER` en **super-utilisateur**. Chez nous, c'est `cenacle_owner`, vérifié le 13/11 sur la base (Postgres 18) : `rolsuper`, `rolcreaterole`, `rolcreatedb`. Les programmes ne s'en servent pas — ils ont `cenacle_app` et `cenacle_executor`, bridés (ADR-0013) —, seules les migrations, les planchers de purge et les tests le chargent (`.env.owner`).

Un super-utilisateur peut tout, au-delà de la base : lire et écrire des fichiers du conteneur, lancer une commande du système (`COPY … TO PROGRAM`), ignorer toute règle. Le mot de passe de `.env.owner` qui fuirait donnerait donc un accès au conteneur, pas seulement aux tables. L'audit du 13/11 (lot A) l'a relevé.

### Ce que l'essai a montré (14/11)

La première version de cette ADR retirait simplement le droit de super-utilisateur à `cenacle_owner`. Un essai sur un conteneur jetable de la même image (`postgres:18-alpine`) a montré que c'est impossible, et relevé deux autres points :

- `cenacle_owner` est le **rôle d'origine** de l'instance (OID 10), celui que l'image crée à l'initialisation. Postgres refuse de lui retirer `SUPERUSER`, même depuis un autre super-utilisateur : « The bootstrap superuser must have the SUPERUSER attribute ».
- `REASSIGN OWNED BY` est refusé pour ce rôle (certains objets du système lui appartiennent). Le transfert **objet par objet** (`ALTER … OWNER TO`) marche.
- Un rôle qui n'est pas super-utilisateur ne peut pas écrire `NOSUPERUSER` dans un `ALTER ROLE`, même sur un rôle qui ne l'est pas : la remise des mots de passe par `db:migrate` (`loginRole`) doit changer.
- `DROP DATABASE … WITH (FORCE)`, qui recrée la base de test, doit couper les connexions des autres rôles : sans `pg_signal_backend`, c'est refusé.

## Décision

1. **Le rôle d'origine devient l'administrateur** : renommé `cenacle_admin` (le renommage est permis), il reste super-utilisateur, comme Postgres l'exige. Son mot de passe actuel passe de `.env.owner` à `.env.admin`, une famille de secrets à elle, chargée par **aucun programme** ni par les migrations ; seulement à la main, pour ce qui demande vraiment un super-utilisateur.
2. **Un nouveau `cenacle_owner`, sans `SUPERUSER`**, avec un nouveau mot de passe dans `.env.owner`, et seulement ce dont les migrations et les tests ont besoin :
   - propriétaire de la base `cenacle` (donc du schéma `public`), de chaque table et de chaque fonction, **transférées objet par objet** (les séquences et les index suivent leur table) ;
   - `CREATEROLE`, avec l'option `ADMIN` sur `cenacle_app` et `cenacle_executor`, sans en hériter les droits (`INHERIT FALSE`, `SET FALSE`) ;
   - `CREATEDB`, pour que les tests créent et suppriment `cenacle_test` ;
   - membre de `pg_signal_backend`, pour couper les connexions à la base de test avant de la supprimer (ce rôle ne peut jamais couper celles d'un super-utilisateur).
3. **`db:migrate` ne réécrit plus les attributs des rôles** : il remet le mot de passe, puis **relit** `pg_roles` et refuse de continuer si `cenacle_app` ou `cenacle_executor` a gagné un droit (`SUPERUSER`, `CREATEROLE`, `CREATEDB`, `BYPASSRLS`, `REPLICATION`).
4. **La bascule, une fois, par une commande** (`npm run db:bascule`), après une sauvegarde de la base :
   - avec le rôle d'origine (`.env.owner` actuel), créer un super-utilisateur **temporaire**, le seul à pouvoir renommer le rôle d'origine (on ne renomme pas le rôle de sa propre session) ;
   - avec lui, en **une transaction** : renommer `cenacle_owner` en `cenacle_admin`, créer le nouveau `cenacle_owner`, lui transférer la base, les tables et les fonctions, lui donner l'option `ADMIN` et `pg_signal_backend` ;
   - supprimer le rôle temporaire et la base de test (les tests la recréent, avec le nouveau propriétaire) ;
   - écrire `.env.admin` et le nouveau `.env.owner` (droits `0600`, aucun mot de passe affiché).
   **Retour arrière** : avec `cenacle_admin`, rendre la base, les tables et les fonctions, supprimer le nouveau `cenacle_owner`, puis renommer `cenacle_admin` en `cenacle_owner` (depuis un rôle temporaire, de la même façon) et remettre l'ancien `.env.owner`.
5. **Une installation neuve** n'a pas besoin de bascule : l'image crée directement `cenacle_admin` (`POSTGRES_USER`), et un script d'initialisation (`docker-entrypoint-initdb.d`) crée `cenacle_owner` sans `SUPERUSER` et lui donne la base.
6. **Vérifié par le code** : un test refuse que le rôle des migrations soit super-utilisateur ; d'autres vérifient que `db:migrate`, `db:planchers` et la recréation de la base de test marchent sans, et que ce rôle se voit refuser `COPY … TO PROGRAM`, la lecture d'un fichier du serveur et `ALTER SYSTEM`.

## Conséquences

- Un `.env.owner` qui fuit ne donne plus accès au conteneur : seulement aux objets de Cénacle, comme leur propriétaire.
- Un secret de plus (`.env.admin`), à sauvegarder chiffré avec les autres (`secrets:backup`), qu'aucun programme ne charge.
- Le propriétaire peut toujours modifier ses propres tables, y compris désactiver un déclencheur : cette ADR ferme l'accès au système, pas le pouvoir du propriétaire sur Cénacle (les rôles séparés de l'ADR-0013 restent la défense des programmes). Il peut aussi couper les connexions des programmes (`pg_signal_backend`), ce qui reste dans le périmètre de Cénacle.
- Un objet créé un jour à la main avec `cenacle_admin` appartiendrait à l'administrateur : un test vérifie qu'aucun objet du schéma `public` n'appartient à un autre rôle que `cenacle_owner`.
- Relu pour l'essai : aucune migration existante ne demande un droit de super-utilisateur (ni extension, ni `ALTER SYSTEM`, ni langage non sûr). Les six fonctions `SECURITY DEFINER` s'exécuteront avec les droits du nouveau propriétaire, qui possède les tables qu'elles touchent ; l'essai l'a vérifié pour une purge.

## Options écartées

- **Garder le super-utilisateur, et l'inscrire comme risque accepté** : le moins de travail, mais le mot de passe des migrations reste une clé du conteneur.
- **Retirer `SUPERUSER` à `cenacle_owner`** (première version de cette ADR) : impossible, c'est le rôle d'origine de l'instance.
- **Garder le nom `cenacle_owner` pour l'administrateur et donner un autre nom au nouveau propriétaire** : évite le rôle temporaire, mais le nom « propriétaire » désignerait alors le super-utilisateur, et chaque script qui se connecte en propriétaire changerait de nom de rôle.
- **Changer seulement `POSTGRES_USER` dans `compose.yaml`** : sans effet sur un volume existant, l'image ne le lit qu'à la première création (retenu pour les installations neuves, point 5).
