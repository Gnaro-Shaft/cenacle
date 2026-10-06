# Décisions d'architecture (ADR)

Une décision structurante par fichier. Chaque ADR dit **ce qui a été décidé, pourquoi, ce que ça coûte et ce qui a été écarté**.
Elles sont rédigées en français (le code et le README sont en anglais).

| N° | Décision | Statut |
|---|---|---|
| [0001](0001-pi-typescript.md) | TypeScript + Pi ; pas de LangChain ; LangGraph différé | Acceptée |
| [0002](0002-cerveau-local-sentinelle.md) | Le cerveau vit sur le Mac, un petit VPS sert de sentinelle sans contenu | Acceptée |
| [0003](0003-routage-des-modeles.md) | Le contenu des mails ne quitte jamais le modèle local ; s'il est indisponible, on attend | Acceptée |
| [0004](0004-propositions-et-validation.md) | L'agent propose, l'humain valide, un exécuteur sans IA agit | Acceptée |
| [0005](0005-injection-par-les-mails.md) | Casser la « trifecta mortelle » par construction | Acceptée |
| [0006](0006-interfaces.md) | Page web installable (PWA) pour lire et valider ; Telegram pour le chat et les compteurs | Acceptée |
| [0007](0007-classement-et-alertes.md) | Classement en 3 cases + « À trier », règles d'abord ; alertes groupées | Acceptée |
| [0008](0008-journal-et-etats.md) | Un journal d'événements append-only, source des états affichés | Acceptée |
| [0009](0009-conformite-executable.md) | Le registre des traitements est un fichier que le code applique | Acceptée |
| [0010](0010-tests-et-jeux-de-mails.md) | Boîtes de test, jeu de mails fictifs, tests adversariaux | Acceptée |
| [0011](0011-depot-public.md) | Un dépôt public se pense dès le premier commit | Acceptée |
| [0012](0012-memoire-du-courrier.md) | Ce qu'Iris retient d'un mail : des clés, pas des adresses, 90 jours | Acceptée |
| [0013](0013-qui-accepte.md) | Seule la page peut accepter : acceptation signée, états clos définitifs | Acceptée |
| [0014](0014-authentification-expediteur.md) | Un « client » doit être authentifié par notre propre serveur | Acceptée |
| [0015](0015-ouverture-de-la-vraie-boite.md) | Ouvrir la vraie boîte aux brouillons et aux envois, en deux crans datés | Acceptée |
| [0016](0016-tous-les-dossiers.md) | Iris lit tous les dossiers de la boîte, et suit un mail déplacé | Acceptée |

Les règles dures qui s'appliquent à tout le code sont dans [`../charte.md`](../charte.md).
