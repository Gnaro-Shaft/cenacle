# ADR-0041 — Les rappels : poser, garder l'heure, faire sonner, sans Legion

**Statut** : proposée (2026-11-16) — reprend l'ADR-017 de Legion (« Les rappels ») ; ouvre le traitement T-10

## Contexte

Cénacle remplacera Legion (10/10, redit le 14/11). L'inventaire du 16/11 des agents que Legion fait tourner sur le Mac a montré qu'un seul rend un service que Cénacle n'a pas : **les rappels**. Je pose « rappelle-moi telle chose à telle heure », et à l'heure dite quelque chose sonne. Cénacle n'a rien de tel : Iris me rappelle les mails sans réponse, mais ce n'est pas un rappel que je pose. Je m'en sers encore (16/11) : il faut le porter avant d'arrêter Legion.

Ce que Legion fait, et que cet ADR reprend (son ADR-017, son code `legion/commande/rappels.py`, son agent `sonner-les-rappels.py`) :

- **le serveur garde l'heure, le poste fait entendre la cloche** — chez Legion, deux machines ; chez Cénacle, tout est sur le Mac ;
- **relever n'est pas entendre** : un rappel n'est marqué « sonné » qu'**après** avoir été entendu ; l'ordre est « sonner, puis confirmer » — au pire une double sonnerie, jamais une perte ; un index unique empêche deux confirmations ;
- **l'échéance est un instant**, ramené en UTC à la pose ; sans fuseau, elle se lit dans l'heure de qui la tape ;
- **le texte d'un rappel ne s'exécute pas** : il est rendu tel quel, jamais interprété ;
- **une conservation par état** : 90 jours après la sonnerie ; un rappel qui n'a pas sonné n'est jamais purgé, il sert encore.

Ce que Legion fait aussi, et que cet ADR **ne reprend pas** : la bannière macOS et la note du coffre (Cénacle ne touche pas au coffre), le rappel qui cite un message (son ADR-019), le tableau de bord. Chacun pourra venir plus tard, par un ADR à lui.

Une difficulté que Legion n'avait pas : **Telegram**. Chez Legion, le texte d'un rappel ne quittait pas mes machines. Chez Cénacle, la voie naturelle — poser depuis le téléphone, entendre partout — passe par Telegram, hors UE. Or le registre dit aujourd'hui que Telegram ne reçoit **aucune donnée de tiers**, et un rappel peut nommer quelqu'un (« rappeler Untel pour le devis »).

## Décision

1. **Le registre des rappels vit dans la base de Cénacle**, sur le Mac : une table `rappels` — le texte, l'échéance (UTC), l'instant de la pose, celui de la sonnerie, rien d'autre. Ni expéditeur, ni adresse, ni pièce : un rappel est du texte que j'ai tapé.

2. **Le bot Telegram fait sonner.** Il tourne en permanence, il est seul à parler sur Telegram (ADR-0006) : chaque minute, il relève les rappels échus, envoie chacun, puis le marque sonné — dans cet ordre (l'ADR-017 de Legion). Un envoi qui échoue laisse le rappel dû : il repartira au passage suivant. Précision : la minute (Legion : cinq). Le Mac en veille, le rappel sonne au réveil, en retard mais pas perdu, et le message dit son échéance d'origine.

3. **Je pose, je vois et j'annule depuis Telegram**, par trois commandes : `/rappel <quand> <texte>`, `/rappels` (les prochains, numérotés), `/annuler <n°>`. Seule ma conversation est écoutée (ADR-0006).
   - **L'échéance s'écrit dans une grammaire fermée, sans modèle** : `2026-11-20 09:00`, `20/11 09:00`, `demain 09:00`, `dans 2 h` (ou `min`, `j`). Elle se lit dans l'heure de Paris (`TIME_ZONE`). Une forme ambiguë, une date passée, une heure qui n'existe pas (le changement d'heure) est **refusée et dite**, jamais devinée.
   - **Le texte est rendu tel quel** : longueur bornée, caractères de contrôle refusés, jamais interprété par un modèle ni exécuté.
   - Le bot répond par l'échéance relue (« Rappel n°12, jeudi 20/11 à 09:00 ») : une erreur de lecture se voit à la pose, pas à l'heure.

4. **Pas de donnée de tiers dans un rappel : la règle de `/cto`.** Je n'y mets ni nom de client, ni contenu de mail, ni donnée d'une autre personne. La règle est rappelée par `/aide` et dans chaque accusé de pose. Elle repose sur moi : aucun filtre automatique n'est fiable (même constat que pour `/cto`, décidé le 09/10). Le registre en prend acte (T-10, et la ligne Telegram des sous-traitants).

5. **Conservation, effacement, droits.**
   - Un rappel est **effacé pour de vrai 90 jours après sa sonnerie** ; un rappel non sonné n'est jamais purgé (il sert encore) ; un rappel annulé est **effacé aussitôt** — pas de suppression logique. La purge passe à chaque relève et laisse une trace *qu'*elle a effacé, jamais *ce qu'*elle a effacé (charte, règle 4).
   - Les messages déjà envoyés restent dans ma conversation Telegram : c'est à moi de les y effacer ; le registre le dit.
   - Accès et portabilité : `/rappels` montre ce qui vient ; ce qui a sonné est dans la conversation.

6. **Aucune IA.** Ni la pose, ni la lecture de l'échéance, ni la sonnerie ne passent par un modèle. Rien à inscrire au registre de l'IA.

7. **Tests adversariaux exigés** : une échéance ambiguë, passée, inexistante (changement d'heure), hors bornes, est refusée ; un texte avec caractères de contrôle ou trop long est refusé ; un rappel n'est marqué sonné qu'après un envoi réussi, et un envoi qui échoue le laisse dû ; deux relèves concurrentes ne le font pas sonner deux fois au-delà de ce que l'ordre « sonner, puis confirmer » admet ; un rappel annulé ou purgé n'existe plus en base ; seule ma conversation peut poser, voir ou annuler.

## Paliers

- **P0** — cet ADR, pour relecture.
- **P1** — la table et sa purge, la grammaire de l'échéance, les trois commandes, la sonnerie par le bot ; le registre (T-10) et `/aide`.
- **P2** — par moi : je repose dans Cénacle les rappels encore en attente chez Legion (je les lis sur son tableau de bord), puis l'agent `fr.gnaro.legion.rappels` s'arrête.

## Conséquences

- Les rappels ne dépendent plus de Legion ; son agent `rappels` peut s'arrêter. Il servait aussi d'alarme « Legion ne répond plus » : elle n'a plus d'objet une fois Legion arrêté.
- **Un traitement de plus** (T-10) : du texte que j'ai tapé, sur le Mac, 90 jours après la sonnerie ; et, en transit, chez Telegram — hors UE, sous ma règle.
- **Le bot gagne un travail de fond** : une relève par minute. Il reste seul à parler sur Telegram et seul à détenir son jeton.
- Un rappel ne sonne que si le Mac est éveillé et le bot en marche. La sentinelle (ADR-0002) entend déjà Iris, l'exécutant et l'agent sécurité ; le bot ne lui envoie pas encore de battement. **Un bot arrêté retarderait les rappels sans le dire** — à corriger par un battement du bot vers la sentinelle, dans P1 ou juste après.

## Options écartées

- **Tout garder sur le Mac** (poser depuis la page, Telegram ne dit que « Rappel n°12 ») : aucun texte hors UE, mais plus de pose depuis le téléphone, et lire un rappel demande d'ouvrir la page. Écartée le 16/11 ; possible plus tard si la règle du point 4 ne tenait pas.
- **La bannière macOS et la note du coffre, comme Legion** : rien hors UE, mais le rappel ne m'atteint que devant le Mac, et Cénacle ne touche pas au coffre.
- **Lire l'échéance par le modèle local** (« lundi prochain en fin de matinée ») : plus souple, mais une heure devinée est une heure qu'on manque ; une grammaire fermée refuse ce qu'elle ne sait pas lire.
- **Garder l'agent `rappels` de Legion** : l'objet même de la décision du 10/10.
