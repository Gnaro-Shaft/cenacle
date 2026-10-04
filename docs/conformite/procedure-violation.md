# Procédure en cas de violation de données — Cénacle

> Rédigée le 2026-10-04, sur le modèle de celle de Myriade. Ce document n'est
> pas un avis juridique : il organise la réaction ; les qualifications (risque,
> notification) reviennent au responsable de traitement, Gnaro (EURL).
> Référence : RGPD art. 33 et 34.

## Ce qui compte comme violation, ici

Toute destruction, perte, altération, divulgation ou tout accès non autorisé aux données de Cénacle, accidentel ou malveillant.

| Cas | Données exposées |
|---|---|
| Vol, perte ou compromission du **Mac** | Base PostgreSQL : mémoire des mails (UID, dates, cases, clés HMAC), brouillons dont le texte n'est pas encore effacé, journal ; **les secrets** : mot de passe de la boîte, `CENACLE_MAIL_KEY`, clé privée de la page, mot de passe de l'exécuteur |
| Fuite d'un **secret** (fichier `.env*` copié, commité, affiché) | Selon le secret : la boîte entière (mot de passe), la réversibilité des clés HMAC (`CENACLE_MAIL_KEY`), la possibilité d'accepter à ma place (clé de la page) |
| **Envoi erroné** | Une réponse partie vers la mauvaise personne, ou contenant ce qui ne devait pas partir |
| **Telegram** compromis | Des compteurs et mes commandes ; aucune donnée de correspondant |
| Compromission de la **boîte** chez OVH | Hors de Cénacle, mais à traiter avec : l'identifiant vit sur le Mac |

Un incident sans donnée personnelle touchée (panne, modèle indisponible) n'est pas une violation, mais se consigne quand même.

## Les 72 heures

Le délai court à partir du moment où l'on **a connaissance** de la violation.

**Dans l'heure — contenir**
1. Arrêter les envois : `/stop` sur Telegram, ou arrêter les programmes (`npm run executor`, `npm run iris`, `npm run server` : Ctrl+C).
2. Changer le mot de passe de la boîte chez OVH. Il ne doit plus fonctionner depuis le Mac tant que l'enquête n'est pas finie.
3. Selon le secret en cause :
   - clé de la page : `rm .env.page && npm run keys:accept`, puis mettre la nouvelle clé publique dans `.env` (les acceptations pas encore envoyées échouent : c'est voulu) ;
   - mot de passe de l'exécuteur : en tirer un nouveau dans `.env.executor`, puis `npm run db:migrate` ;
   - `CENACLE_MAIL_KEY` : la changer, puis vider la table `mail_items` (la mémoire des mails se relit à la relève suivante).
4. Ne rien effacer qui serve l'enquête : la purge peut attendre quelques jours.

**Dans les 24 heures — évaluer**
- Quelles données, combien de personnes, depuis quand, par quelle voie ?
- Les données étaient-elles lisibles (texte d'un brouillon) ou pseudonymisées (clés HMAC sans le secret) ?
- Le risque pour les personnes : nul, réel, ou élevé ?

**Avant 72 heures — notifier, si besoin**
- **Risque pour les personnes** : notifier la CNIL (téléservice de notification des violations). Une notification incomplète vaut mieux qu'une notification en retard ; on la complète ensuite.
- **Risque élevé** : informer aussi les personnes concernées, directement, en termes clairs.
- **Aucun risque** (par exemple : un secret exposé, mais changé avant tout usage, et des données seulement pseudonymisées) : pas de notification, mais la violation est **documentée** quand même.

## Documenter

Chaque violation, notifiée ou non, est consignée **hors du dépôt** (elle contient des faits réels) : date de connaissance, faits, données et personnes touchées, conséquences, mesures prises, décision de notifier ou non, et pourquoi.

## Après

- Corriger la cause, et ajouter un test adversarial qui l'aurait attrapée (charte, règle 8).
- Revoir l'AIPD (`aipd.md`).
