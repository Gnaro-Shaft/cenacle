# Registre des traitements — Cénacle

> Tenu à jour à chaque nouveau traitement. Une source n'est branchée qu'une fois
> inscrite ici, puis déclarée dans le cadre exécutable (ADR-0009, jalon C1).
> Ce registre n'est pas un avis juridique : ce qui est marqué « à trancher »
> relève du responsable de traitement.

**Responsable de traitement** : Gnaro (EURL), pour l'usage professionnel de son dirigeant.
**État au 2026-10-04** : **aucun traitement de données réelles n'est ouvert.** Les phases 1 à 4 n'ont utilisé que des boîtes de test et un jeu de mails fictifs (ADR-0010). Les traitements ci-dessous sont **prévus pour la phase 5** et ne s'ouvriront qu'une fois les jalons C0 à C4 faits (`docs/phase-5.md`).

Rédigé par Claude le 2026-10-04, sur le modèle des registres de Myriade et de Legion. **Validé par le responsable le 2026-10-04.**

## Traitements

| # | Traitement | Finalité | Personnes concernées | Données | Base légale | Conservation | Sous-traitant / lieu | État |
|---|---|---|---|---|---|---|---|---|
| T-01 | Relève et rangement des mails (ADR-0007, ADR-0012) | Ranger chaque mail de la boîte pro dans une case (clients et prospects, administratif, bruit, à trier) | Expéditeurs et destinataires des mails de la boîte pro | **Stockées** : UID IMAP, date d'arrivée, case et qui l'a décidée (règle ou modèle), **clés HMAC** de l'expéditeur, des destinataires et des identifiants de conversation (aucune adresse en clair). **Lues en mémoire, jamais stockées** : objet, texte du mail (2 000 caractères au plus), nom affiché, domaine — données au **modèle local** seulement | Intérêt légitime (validé le 2026-10-04) | **90 jours** après l'arrivée, purge à chaque relève ; mémoire effacée si la boîte est renumérotée | OVH (hébergeur de la boîte, France, déjà en place) ; traitement sur le Mac | Prévu |
| T-02 | Suivi des réponses et alertes (phase 3) | Savoir quels mails de clients et de prospects attendent ma réponse ; me le rappeler après 48 h ouvrées ; m'alerter d'un mail urgent | Les mêmes | Dérivées de T-01, et **mes mails envoyés** réduits à leurs clés HMAC et à leur date. Vers Telegram : **des compteurs seulement**, jamais d'objet, d'adresse ni de contenu | Intérêt légitime (validé le 2026-10-04) | 90 jours (comme T-01) | Telegram (compteurs, sans donnée de tiers, voir plus bas) | Prévu |
| T-03 | Brouillons proposés (phase 4, ADR-0004) | Me proposer une réponse type, que je relis, corrige, accepte ou refuse | L'expéditeur du mail ; les personnes citées dans le fil | Texte du brouillon (prénom, objet, valeurs recopiées du fil, ma signature), trame choisie, UID du mail, statut, dates, signature de mon acceptation. Le modèle local voit l'objet et le texte du mail, jamais rien d'autre | Intérêt légitime (validé le 2026-10-04) | Texte **effacé 7 jours** après la clôture ; ligne **supprimée 90 jours** après la clôture (C1) ; une proposition ouverte n'est jamais touchée | Mac | Prévu |
| T-04 | Envoi des réponses acceptées (phase 4, ADR-0013) | Envoyer, au plus une fois, ce que j'ai accepté sur la page | Le destinataire de la réponse (l'expéditeur du mail) | Texte accepté ; **adresse du destinataire relue sur le serveur au moment de l'envoi, jamais stockée** ; copie dans mon dossier Envoyés | Intérêt légitime (validé le 2026-10-04) | Rien de plus que T-03 ; la copie dans la boîte suit la boîte | OVH (SMTP, France) | Prévu |
| T-05 | Journal d'événements (ADR-0008) | Afficher les états d'Iris ; tracer ce qui a été fait | Indirectement, les correspondants (par les identifiants de propositions) | Types d'événements, compteurs, identifiants de propositions ; **aucun contenu, objet, adresse ni nom** (vérifié par les tests) | Intérêt légitime (validé le 2026-10-04) | **180 jours** (C1) ; la purge efface vraiment et laisse une trace *qu'*elle a effacé, jamais *ce qu'*elle a effacé (charte, règle 4) | Mac | Prévu |
| T-07 | Liste d'opposition (C3) | Respecter l'effacement ou l'opposition d'une personne : ses mails ne sont plus jamais lus ni retenus | Les personnes qui ont exercé ce droit | **La clé HMAC de leur adresse** et la date de la demande ; rien d'autre | Obligation légale (art. 6.1.c, pour respecter les art. 17 et 21) | Jusqu'à ce que la personne retire son opposition | Mac | Prévu |
| T-06 | Traces techniques (OpenTelemetry, Tempo) | Diagnostic, performance | Aucune directement | Durées, noms d'opérations, erreurs ; **aucun texte** (test qui le prouve, phase 1) | Intérêt légitime | **7 jours** (`deploy/observability/tempo.yaml`) | Mac | Prévu |

## Services tiers et sous-traitants

| Service | Usage | Données reçues | Lieu | Remarque |
|---|---|---|---|---|
| **OVH** | Hébergement de la boîte pro (IMAP, SMTP) | La boîte elle-même | France | Déjà sous-traitant de l'activité avant Cénacle ; Cénacle n'en ajoute aucun |
| **Telegram** | Compteurs, alertes et commandes (`/etat`, `/stop`) avec moi seul (ADR-0006) | Mes commandes et des compteurs ; **aucune donnée de tiers** (vérifié par le banc des alertes, phase 3 : 0 contenu dans Telegram) | Hors UE | Ne reçoit aucune donnée des correspondants. À revoir si un message devait un jour en contenir : il ne le doit pas |
| **Modèle local** (LM Studio, sur le même Mac) | Rangement, choix de trame, recopie de cases | Objet et texte d'un mail, le temps d'un appel | Mac | **Aucun fournisseur d'IA** ne reçoit de contenu (ADR-0003) : si le modèle local est indisponible, on attend |
| **Tailscale** | Nom réseau par lequel les programmes joignent le modèle, sur le même Mac | **Aucun contenu** : le trafic ne quitte pas la machine ; le service de coordination ne voit que des métadonnées de connexion | Hors UE | Ne voit pas les mails |

Aucun transfert hors UE de données des correspondants : le contenu ne sort pas de mes machines.

## Points ouverts

- **Bases légales** : intérêt légitime pour T-01 à T-06, validé le 2026-10-04, comme pour les outils internes de Legion et de Myriade. Ce qui fait pencher la balance : finalité au service des correspondants autant que du responsable (leur répondre), contenu traité en local et jamais stocké, aucun profilage, aucune décision sans moi.
- **Durées** (C1, décidées le 2026-10-04) : toutes déclarées dans `cadre.toml` (`[conservation]`) et appliquées par le code. Iris purge une fois par jour (texte des brouillons, propositions closes, journal) ; la mémoire des mails est purgée à chaque relève. **Écart corrigé** : jusqu'à C1, l'effacement du texte des brouillons à 7 jours existait dans le code mais n'était jamais lancé.
- **Sauvegardes** (S1, 2026-10-04) : les secrets sont sauvegardés chiffrés, loin du Mac (`docs/securite/secrets.md`). La base n'est pas sauvegardée (décidé le 04/10) : rien n'a donc à suivre les purges et les effacements. **Point ouvert** : la liste d'opposition (T-07) vit dans la base ; si la base est perdue, les oppositions le sont aussi, et des personnes opposées pourraient être relues. À trancher avant M2 : sauvegarder cette seule table, chiffrée, ou noter les oppositions ailleurs.
- **Article 9** (C2, 2026-10-04) : un plancher déterministe, sans IA, écarte avant le modèle tout mail qui semble révéler une catégorie particulière (art. 9 et 10). Un mail écarté va dans « À trier », sans brouillon, avec une marque unique « écarté » qui ne dit pas pourquoi : la raison n'est jamais conservée. Banc : 18 mails fictifs sensibles sur 18 écartés ; 2 mails ordinaires sur 147 écartés à tort (noms de sociétés du secteur de la santé dans la signature). Un mail écarté porteur d'un terme d'urgence garde son alerte. La liste n'est pas exhaustive.
- **Droits des personnes** (C3, 2026-10-04) : `npm run personne` exporte (JSON) ce que Cénacle détient sur une adresse, l'efface, ou la retire de la liste d'opposition. L'adresse est demandée au clavier, jamais en argument ; l'export est écrit pour moi seul. L'effacement retire ses mails, ses propositions (même acceptées : elles ne partiront jamais), sa clé dans mes mails envoyés à plusieurs, et l'inscrit sur la liste d'opposition (T-07) ; il est refusé pendant un envoi en cours. Délai de réponse : un mois, de mon ressort.
- **Information** : la mention publiée sur le site couvre Legion (domaines seulement, aucun modèle) ; elle doit être révisée pour Cénacle avant l'ouverture (C4).
- **Legion** : il lit la même boîte (son traitement T-002). Les deux coexistent jusqu'à ce que Cénacle le remplace ; son registre devra alors être clos.
