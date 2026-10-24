# ADR-0033 — Le contexte du CTO : un socle, une carte, et les documents de la question

**Statut** : proposée (2026-10-24) — révise l'ADR-0017 (§ 3 : « un budget de taille et un ordre fixe ») ; garde l'ADR-0021 (les outils et leurs budgets)

## Contexte

À chaque question, le CTO reçoit **toute** la documentation versionnée du projet (ADR-0017, § 3) : `CLAUDE.md`, le README, la charte, les phases, la sécurité, les ADR du plus récent au plus ancien, puis le reste, dans un budget de caractères (`CONTEXT_BUDGET`). Un test d'alarme exige que rien ne soit écarté par ce budget.

Cela ne tient plus :

- **Le budget a été relevé trois fois en deux semaines** : 200 000 → 240 000 (11/10) → 280 000 → 300 000 caractères (23/10). La documentation en fait aujourd'hui 281 600, dont 165 000 pour les ADR et 58 000 pour la conformité. Chaque nouvel ADR fait tomber l'alarme, donc la CI (#144, #158), et la seule réponse prévue est de relever encore.
- **La fenêtre du modèle approche.** Le CTO travaille dans 131 072 tokens. À environ 3,4 caractères par token, la documentation en prend déjà quelque 83 000 ; les outils peuvent ajouter jusqu'à 150 000 caractères (ADR-0021), soit environ 44 000 tokens. On arrive vers 127 000 tokens avant la réponse : un relèvement de plus pourrait faire tronquer le prompt par le serveur, sans erreur visible. Ces chiffres sont des estimations, pas une mesure.
- **Chaque question relit tout** : 80 000 tokens de documentation pour une question qui porte le plus souvent sur un ou deux sujets. Le temps de lecture du prompt est payé à chaque fois.
- **Les outils existent déjà.** Depuis J3 (ADR-0021), le CTO lit n'importe quel fichier suivi par git, `docs/` compris. Les rapports de mesure sont déjà passés au régime « lus par les outils, jamais dans le prompt », et la relecture d'une branche n'envoie que quatre documents essentiels.

Il faut que le prompt ne grossisse plus avec le nombre d'ADR, sans que le CTO perde de vue ce qui existe.

## Décision

### 1. Trois parties, toutes choisies par le code

Le modèle ne choisit toujours rien (ADR-0017, § 3 ; charte, règle 2). Le prompt d'une question contient, dans cet ordre :

1. **Le socle**, toujours, en entier : `CLAUDE.md`, `README.md`, `docs/charte.md`, `docs/adr/README.md` (l'index des décisions), les **deux phases en cours** et `docs/securite/`. Environ 34 000 caractères aujourd'hui.
2. **La carte** de tous les autres documents admis : une ligne par document, avec son chemin, son titre (la première ligne `#`) et, pour un ADR, son statut. Environ 8 000 caractères. Elle dit au CTO ce qui existe et où, pour qu'il le lise avec ses outils s'il en a besoin.
3. **Les documents de la question**, en entier, du plus pertinent au moins pertinent, jusqu'au budget (§ 3).

Les règles d'admission ne changent pas : jamais un `.env*`, un `*.local.toml`, un `fixtures/`, un lien symbolique, un fichier hors du dépôt, un binaire, un fichier trop gros ; un fichier qui ressemble à un secret est écarté entier, **et n'apparaît pas non plus dans la carte**. Les rapports de `docs/mesures/` restent lus par les outils seulement ; ils figurent dans la carte.

### 2. Le choix selon la question : un score lexical, déterministe

- **La question est découpée en mots** : en minuscules, sans accents, sans les mots vides du français et de l'anglais, trois lettres au moins.
- **Chaque document reçoit un score** par une formule de pertinence classique, de type BM25 : un mot rare dans la documentation compte plus qu'un mot fréquent ; un document n'est pas favorisé par sa seule longueur ; un mot trouvé dans le **titre** compte plus que dans le corps.
- **Une référence explicite passe avant tout** : un numéro d'ADR (« ADR-0025 », « 0025 ») ou un chemin de document cité dans la question prend ce document en premier.
- **À score égal**, l'ordre fixe actuel (ADR-0017) départage : même question et même documentation donnent le même contexte, à chaque appel.
- **Une question sans mot utile** (faite seulement de mots vides, de chiffres ou de ponctuation) ne reçoit que le socle et la carte.

Aucun modèle, aucun index stocké, aucune dépendance nouvelle : le score est calculé à chaque question, sur les fichiers suivis par git, comme aujourd'hui.

### 3. Les budgets

- **Toute la documentation du prompt : 120 000 caractères au plus** (socle, carte et documents de la question ensemble). Les documents de la question disposent donc d'environ 78 000 caractères aujourd'hui. Avec les outils au maximum, on reste vers 80 000 tokens, loin de la fenêtre.
- **Un document de la question entre entier ou pas du tout** : jamais coupé. S'il ne tient pas, on passe au suivant.
- **Ce qui ne tient pas reste dans la carte.** Qu'un ADR soit laissé hors du prompt n'est plus une panne : c'est le fonctionnement normal.

### 4. Les autres usages du CTO

- **La relecture d'une branche** garde son jeu de quatre documents essentiels (ADR-0021), inchangé.
- **La passe de conformité** (ADR-0022) reçoit le socle, tout `docs/conformite/`, les **trois ADR les plus récents** (sa question porte sur « un ADR récent ») et la carte, dans le même budget. Elle ne dépend pas d'une question écrite par moi.
- **La veille** (ADR-0024) n'utilise pas ce contexte : inchangée.

### 5. L'alarme change d'objet

Le test d'alarme ne vérifie plus que « rien n'est écarté ». Il vérifie, sur la documentation réelle du dépôt :

- que **le socle et la carte tiennent dans 60 000 caractères**. S'ils n'y tiennent plus, c'est un vrai signal — un document du socle devenu trop long, une carte trop large — qui se règle par une décision, pas par un relèvement ;
- que **chaque document admis apparaît en entier ou dans la carte**, jamais nulle part ;
- qu'un document qui ressemble à un secret n'apparaît **ni en entier ni dans la carte**.

### 6. Mesurer avant d'adopter

Le banc des 17 questions du 2026-10-09 n'est pas dans le dépôt. Avant de livrer le changement :

- **Un banc versionné de questions sur la documentation** (`npm run cto:banc-docs`) : une quinzaine de questions dont la réponse est **dans la documentation**, chacune avec ses points attendus fixés à l'avance. La moitié au moins portent sur un ADR ancien, celui que le nouveau contexte risque de laisser à la carte. Aucune donnée réelle dans les questions.
- **Deux passages par contexte** (l'ancien, le nouveau), même modèle, même température : points couverts, inventions, appels d'outils, temps de réponse. Le rapport va dans `docs/mesures/`.
- **Critère** : le nouveau contexte couvre **au moins autant de points** que l'ancien, aux écarts de bruit près entre deux passages (dits dans le rapport), sans invention nouvelle. Sinon, on ne livre pas, et on revient ici avec la mesure.
- Le banc des 12 questions sur le code (`docs/mesures/bascule-qwen36.md`) n'a pas besoin d'être refait : ses réponses ne sont pas dans la documentation.

## Conséquences

- **Plus de relèvement de budget à chaque ADR** : la documentation peut grandir sans faire tomber la CI.
- **Un prompt plus court**, environ 35 000 tokens de documentation au lieu de 83 000 : chaque question devrait être lue plus vite. À confirmer par le banc.
- **Le CTO peut manquer un document** que le score n'a pas retenu. La carte et ses outils sont le filet : il le voit dans la carte et peut le lire, mais ses six appels sont partagés entre la documentation et le code. C'est le risque principal, et la raison du banc.
- **Une question mal formulée donne un moins bon contexte** qu'aujourd'hui : le score est lexical, un synonyme absent de la documentation ne trouve rien. Le socle et la carte restent toujours là.
- **Le contexte dépend désormais de la question.** Le journal compte toujours les documents envoyés ; il pourra compter aussi les documents choisis, jamais leur contenu ni la question (ADR-0017, § 6).
- **Rien ne change pour les données** : mêmes fichiers admis, même modèle local, aucun nouveau traitement, aucun tiers. Le classement du CTO au registre IA ne change pas.

## Options écartées

- **Relever encore le budget** : repousse le problème, et la fenêtre du modèle est proche.
- **Ne garder que la section « Décision » de chaque ADR** : la documentation continue de grossir, et le contexte et les options écartées d'un ADR sont souvent ce qui répond à « pourquoi ».
- **Socle et carte seulement, tout le reste par les outils** : simple, mais le CTO dépenserait ses six appels à relire des ADR au lieu du code.
- **Des embeddings et un index vectoriel** : plus fins pour les synonymes, mais un modèle de plus à servir, un index à tenir à jour, pour un besoin que le lexical couvre peut-être. On y reviendra si le banc montre qu'il ne suffit pas.
- **Laisser le modèle choisir ses documents** (une première passe « de quoi as-tu besoin ? ») : le choix passerait au modèle, que ce qu'il lit peut manipuler (ADR-0017, options écartées), et chaque question coûterait deux appels.
