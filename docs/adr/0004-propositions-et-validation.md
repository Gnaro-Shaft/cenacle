# ADR-0004 — L'agent propose, l'humain valide, un exécuteur sans IA agit

**Statut** : acceptée (2026-10-02) — reprise de l'ADR « Les propositions » de Legion

## Décision

- **L'agent n'a aucun outil d'action irréversible**, et en particulier aucun outil d'envoi de mail. Il ne peut qu'écrire une **proposition**.
- Une proposition porte :
  - **un constat** : ce qui a été vu, avec sa source et son instant ;
  - **une action** : une entrée d'un **catalogue fermé écrit en code**, avec sa cible typée ;
  - **une raison** : pourquoi maintenant, en une phrase.

  Le texte d'une proposition ne devient jamais une commande.
- **L'humain accepte ou refuse.** L'acceptation **re-vérifie la situation depuis la source** : si elle ne tient plus (le mail a déjà reçu une réponse), la proposition est close comme **caduque**, et l'interface le dit.
- **Un exécuteur déterministe, sans IA**, réalise l'action acceptée. Seul l'exécuteur détient les identifiants d'envoi.
- **Délai d'annulation de 2 minutes** entre l'acceptation et l'envoi réel.
- **Plafond de 20 envois par jour.** Au-delà, l'exécuteur s'arrête et prévient.
- **Une situation = une proposition.** Une proposition refusée ne revient pas pour la même occurrence.
- **Délégations**, plus tard : « toujours accepter ce type ». Elles sont exactes (pas de motif), tracées (auteur `delegation:<id>`) et révocables.

## Conséquences

- Une attente de validation peut durer des heures sans qu'aucun agent reste « en vie ».
- Chaque acceptation, refus, annulation et envoi est un événement du journal (ADR-0008).

## Alternatives écartées

- **Interruption dans la boucle d'agent** (l'agent attend l'accord puis envoie lui-même) : l'agent détiendrait l'outil d'envoi, et une injection pourrait l'utiliser.
