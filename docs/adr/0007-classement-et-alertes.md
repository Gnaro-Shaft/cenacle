# ADR-0007 — Classement en 3 cases + « À trier », règles d'abord ; alertes groupées

**Statut** : acceptée (2026-10-02)

## Décision — classement

- **Cases** :
  - **Clients & prospects** : alerte et proposition de réponse ;
  - **Administratif & factures** : suivi ;
  - **Bruit** : mis de côté sans alerte, toujours réversible.
- **« À trier »** est une case technique obligatoire : ce que ni les règles ni le modèle ne rangent avec assez de confiance y va. **On ne force jamais un mail dans une mauvaise case.**
- **Règles par expéditeur d'abord**, sans IA :
  - correspondance **exacte** du domaine, sans joker ;
  - une règle **met de côté de façon visible** (auteur `regle:<domaine>`) au lieu de masquer ;
  - poser une règle annonce **combien de mails elle va toucher** avant de s'appliquer ;
  - lever une règle ne défait pas une décision humaine.
- Le **modèle local** ne classe que ce qu'aucune règle ne couvre.

## Décision — alertes

- **Récapitulatif à heures fixes** : 9 h, 13 h, 18 h, du lundi au vendredi. Il ne contient que des **compteurs**.
- **Alerte immédiate** seulement si un mail **Clients & prospects** a un **terme d'urgence dans son objet**. La liste est fermée (« urgent », « urgence », « ASAP », « au plus vite », « dès que possible »), comparée sans casse ni accents, **sans IA**, et appliquée **après** le classement : une publicité « URGENT » reste du Bruit.
- **Heures calmes** : de 20 h à 8 h et le week-end. L'urgent attend le prochain récapitulatif.
- Les termes et les cases seront **ajustés à l'usage**, mesures à l'appui.
