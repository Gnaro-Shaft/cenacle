# Registre IA — Cénacle

> Classification AI Act (règlement (UE) 2024/1689) de chaque fonctionnalité qui
> repose sur un système d'IA, **avant** son ouverture sur des données réelles.
> Ce document n'est pas un avis juridique.

**Rôle de Gnaro (EURL)** : **déployeur**. Un modèle de tiers à poids ouverts tourne en local pour son propre compte. Si Cénacle ou un service bâti dessus est un jour proposé à d'autres, Gnaro deviendrait **fournisseur** et ce registre devrait être revu.

**Modèle** : `qwen/qwen3.8-27b` (Alibaba, poids ouverts), servi par LM Studio sur le même Mac (confirmé le 2026-10-04). Aucun appel à un modèle en ligne (ADR-0003) ; si le modèle local est indisponible, Iris attend.

**Aucune pratique interdite (art. 5)** : ni manipulation, ni notation sociale, ni reconnaissance des émotions, ni biométrie. **Rien de l'annexe III (haut risque)** : Cénacle ne décide ni d'un emploi, ni d'un crédit, ni d'un accès à un service ; il trie et propose pour un seul utilisateur.

Rédigé par Claude le 2026-10-04. **Validé par le responsable le 2026-10-04.**

| # | Fonctionnalité | Finalité | Classe de risque | Garde-fous et obligations | État |
|---|---|---|---|---|---|
| IA-01 | Rangement des mails par le modèle (phase 2, ADR-0007) | Ranger dans une case les mails que les règles n'ont pas rangés | Minimal | Règles sans IA d'abord ; sortie imposée dans une liste fermée ; « À trier » en cas de doute ; un mail n'est **qu'une donnée**, jamais une consigne (ADR-0005) ; pièges sans effet sur le jeu de test | Testé sur boîte fictive |
| IA-02 | Choix de la réponse type, par vote (phase 4, B2) | Choisir une de mes trames, ou aucune | Limité (prépare un texte destiné à un tiers) | Liste fermée de trames écrites par moi ; 6 votes, 5 doivent concorder, sinon **rien n'est proposé** ; mesuré à 9 sur 12 comme moi, 0 autre trame | Testé sur boîte fictive |
| IA-03 | Recopie de cases depuis le fil (phase 4, B2) | Remplir `{creneau}`, `{date}`, `{sujet}` avec des mots du mail | Limité | Chaque mot doit venir du fil ; vérificateur de faits **sans IA** (nombre, date, heure, montant, lien, adresse) ; une valeur douteuse laisse la case vide et visible ; banc d'invention : 550 brouillons piégés, **0 fait inventé** | Testé sur boîte fictive |
| IA-04 | Iris répond à une question (phase 1, `npm run ask`) | Converser avec moi | Limité | Interlocuteur unique : moi, qui sais parler à une IA ; journal sans la question ni la réponse | Outil de développement |

## Transparence (art. 50)

- **Le texte autour des cases est le mien** : une proposition est une de mes trames, dont seules des cases courtes sont remplies par le code ou recopiées du fil. Je relis, je corrige, et **rien ne part sans mon acceptation signée** sur la page (ADR-0004, ADR-0013).
- **Le cas visé par l'art. 50(4)** (texte publié pour informer le public sur des questions d'intérêt public) ne correspond pas à une correspondance privée relue par son auteur. À faire confirmer.
- **Décision du 04/10** : l'aide de l'IA est signalée dans les mentions du site (paragraphe « Mon assistant de messagerie », C4), et chaque réponse envoyée porte l'en-tête lisible par machine `X-AI-Assisted: draft-by-local-model; reviewed-and-accepted-by-sender`.
- **Sur la page**, une proposition est montrée comme une proposition, avec ses alertes : faits absents du fil, cases à compléter, Reply-To ailleurs.

## Limites connues (littératie IA, art. 4)

- **Rangement** : le modèle peut se tromper de case. « À trier » recueille ses doutes. Le taux de bon classement sur la vraie boîte sera mesuré et publié en M2.
- **Choix de la trame** : 3 mails sur 12 n'ont pas eu la trame que j'aurais choisie, ou aucune. Une proposition peut donc tomber à côté : elle se refuse d'un clic.
- **Recopie** : le vérificateur de faits attrape les nombres, dates, heures, montants, liens et adresses. Il ne juge ni le ton ni la pertinence : c'est à moi de relire.
- **Injection** : un mail peut contenir des consignes cachées. Le modèle n'a aucun outil, et un mail ne peut ni accepter ni envoyer ; le banc l'éprouve sur 11 pièges (0 envoi).
- **Données sensibles** (C2) : un plancher déterministe écarte avant le modèle les mails qui semblent révéler une catégorie particulière ; les points d'entrée du modèle refusent eux-mêmes un tel mail (deuxième ligne). La liste n'est pas exhaustive : un mot absent ou une tournure détournée peut passer. On préfère écarter à tort : 2 mails ordinaires sur 147 l'ont été sur le banc.
