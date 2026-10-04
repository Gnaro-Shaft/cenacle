# Examen de la nécessité d'une AIPD — Cénacle (2026-10-04)

> Ce document n'est pas un avis juridique. Il applique la grille publiée par la
> CNIL (lignes directrices du CEPD, 9 critères ; une AIPD est en principe requise
> dès que **deux critères** sont remplis) et consigne le raisonnement. **La
> conclusion revient au responsable de traitement** (Gnaro, EURL).

## Les 9 critères, pour Cénacle sur la vraie boîte (phase 5)

| # | Critère | Rempli ? | Pourquoi |
|---|---|---|---|
| 1 | Évaluation ou notation (profilage) | Non | Un mail est rangé dans une case ; aucune note ni score n'est attribué à une personne |
| 2 | Décision automatisée à effet juridique ou similaire | Non | Rien ne part sans mon acceptation signée sur la page (ADR-0004, ADR-0013) ; un tri erroné ne prive personne de rien |
| 3 | Surveillance systématique | Non, à surveiller | Le modèle lit chaque mail reçu, mais pour ranger *ma* boîte, pas pour observer des personnes |
| 4 | Données sensibles ou **à caractère hautement personnel** | **Oui** | De la correspondance : le contenu des mails de tiers est lu par le modèle ; une donnée de l'article 9 peut s'y glisser (plancher prévu en C2) |
| 5 | Grande échelle | Non | Une boîte professionnelle, ses correspondants |
| 6 | Croisement de données | Non | La boîte et mes envoyés seulement ; aucune autre source |
| 7 | Personnes vulnérables | Non | Aucune visée |
| 8 | **Usage innovant** ou nouvelle technologie | **Oui** | Un modèle de langage lit et prépare des réponses ; la CNIL range l'IA parmi les usages innovants |
| 9 | Exclusion du bénéfice d'un droit ou d'un contrat | Non | Aucun |

**Deux critères remplis (4 et 8).**

## Ce qui pèse dans l'autre sens

- Traitement **entièrement local** : le modèle tourne sur le Mac, aucun fournisseur d'IA ne reçoit de contenu (ADR-0003).
- Aucun sous-traitant ajouté : la boîte était déjà chez OVH, en France.
- Minimisation : ni objet ni corps stockés ; expéditeurs et conversations réduits à des clés HMAC ; texte des brouillons effacé 7 jours après la clôture.
- Aucun envoi sans acceptation humaine signée, délai d'annulation, plafond quotidien.

## Conclusion

Le seuil de la grille est **atteint** : une AIPD est en principe requise.
**Décision du 2026-10-04** : AIPD légère, sur le modèle de celle de Myriade, dans `aipd.md`. À revoir à chaque nouveau traitement, et avant M3 (premiers envois réels).
