# ADR-0005 — Casser la « trifecta mortelle » par construction

**Statut** : acceptée (2026-10-02)

## Contexte

Un agent de messagerie réunit naturellement **données privées + contenu non fiable + moyen de communiquer vers l'extérieur** : c'est la « trifecta mortelle » décrite par Simon Willison. Tout mail entrant est un texte écrit par un inconnu, que le modèle va lire. **La sécurité ne doit jamais dépendre du bon comportement du modèle.**

## Décision

| Mesure | Ce qu'elle casse |
|---|---|
| L'agent qui lit n'a **ni envoi, ni accès web, ni écriture** hors de ses propositions | La communication vers l'extérieur |
| L'envoi passe par l'exécuteur sans IA, après validation humaine (ADR-0004) | La communication vers l'extérieur |
| Un brouillon est rédigé avec **le seul fil concerné** en contexte | L'accès aux autres données privées |
| Sortie du modèle **validée par schéma** : catégorie dans une liste fermée, brouillon en texte simple | La transformation d'une sortie en commande |
| **Destinataire imposé par le code** (l'expéditeur du fil) ; tout ajout de destinataire, de lien ou de pièce jointe absent du fil est **signalé en rouge** à la validation | Une exfiltration masquée |
| Classement **par règles déterministes d'abord**, modèle seulement pour le reste | La surface exposée |
| Mails affichés **en texte brut échappé**, jamais en HTML | Le XSS sur la page |
| Traces et journaux **sans contenu** | Les fuites par l'observabilité |

## Vérification

Le jeu de test contient des **mails pièges** (ADR-0010). Critère de sortie de la phase « brouillons » : **0 action non validée, 0 fuite**.
