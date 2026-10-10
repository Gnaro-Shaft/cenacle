# ADR-0025 — L'agent sécurité : des contrôles sans IA, des constats suivis, le CTO qui pilote

**Statut** : acceptée (2026-10-10) — jalon J6a de la phase 6 ; s'inspire de Legion (propositions, ronde, catalogue)

## Contexte

Rien ne surveillait au quotidien le Mac, les dépendances entre deux PR, ni le serveur : `npm audit` ne tournait qu'à la CI, gitleaks qu'au commit. Le jalon J6 (`docs/phase-6.md`) veut « une faille ou une mise à jour signalée **et suivie** », par un agent que le CTO supervise.

Le dirigeant a fixé la direction (2026-10-10) : l'agent remonte toute incohérence et propose une solution ; le CTO la lui relaie ; il accepte depuis Telegram ; à terme, le CTO règle seul les cas simples, dans des règles précises qui l'encadrent. **Les commandes ne sont jamais écrites par un agent** : elles sont prêtes d'avance, dans un catalogue fermé, et ne se débloquent qu'avec son accord.

## Décision

1. **Des contrôles déterministes, sans IA, en lecture seule, sans `sudo`** : FileVault, pare-feu, SIP, Gatekeeper, mises à jour de logiciels (`softwareupdate -l` ; une nouvelle version majeure de macOS n'est qu'une information), Tailscale (`version --upstream`), `npm audit` et `npm outdated` (une version majeure de retard) de Cénacle. Programmes fixes, chemins absolus, sans shell, environnement réduit, délai et sortie bornés. **Un contrôle qui ne répond pas comme attendu « n'a pas pu tourner »** : il ne prouve rien, ne ferme aucun constat, et devient lui-même un constat.
2. **Des constats suivis** (`securite_constats`), un seul actif par `(type, cible, occurrence)`, garanti par la base :
   - vu une fois : **candidat**, rien n'est dit (un raté passager ne réveille personne) ; revu au passage suivant : **ouvert**, dit une fois ;
   - plus vu par un contrôle qui a tourné : **résolu**, dit une fois ; un candidat disparu : **caduc**, en silence ;
   - **accepté** par moi, avec une raison : il se tait pour cette occurrence ; une nouvelle occurrence (nouvel avis, nouvelle version) est un nouveau constat ; un risque accepté est redemandé après 90 jours ;
   - « dit » seulement **une fois le message parti** : un envoi raté repart au passage suivant.
3. **Un catalogue fermé de corrections**, écrit dans le code : pour chaque type, un conseil, et quand c'est sûr une commande **construite seulement de valeurs vérifiées** par les analyseurs. Ni la sortie d'un outil, ni le modèle n'écrivent une commande ; un type inconnu est refusé. Un avis npm dont le texte donne un ordre n'est pas affiché.
4. **Le CTO pilote et explique** : pour chaque nouveau constat, deux ou trois phrases du modèle local (le constat entre marqueurs, comme une donnée) ; tout ce qui ressemble à une commande, du code ou un lien est retiré ; marqué « généré par IA ». **Aucune IA dans les décisions** : l'ouverture, la fermeture et la sévérité viennent des données.
5. **Les messages** : chaque jour à 7 h 30 (launchd, à heure fixe), seulement s'il y a du nouveau ; chaque lundi, le bilan de ce qui reste ouvert et de ce qui est accepté. `npm run securite -- constats` et `-- accepter <n°> <raison>`. Programme à part, qui ne détient que le jeton Telegram ; une seule exécution à la fois (verrou d'instance).
6. **L'agent ne corrige jamais rien lui-même** (charte, règle 1). Le journal ne reçoit que des nombres.

## Paliers à venir

- **J6b** — accepter depuis Telegram (✅ accepter, ❌ refuser, ☑ accepter le risque), la situation revérifiée au moment de l'accord ; les réglages du Mac restent à moi (jamais de `sudo` pour un agent), les corrections de code passent par une branche et une PR, la fusion restant à moi.
- **J6c** — des délégations pour les cas simples que je nomme, dans un fichier versionné (`securite.toml`) que le CTO ne peut pas modifier : type exact, révocable, tracé, jamais pour ce qui demande un administrateur.
- **J6d** — le serveur (bulletin en lecture seule, puis des scripts fixes posés sur le serveur, joignables par une clé restreinte à eux, déclenchés par mon accord ; un redémarrage reste toujours une question), la surveillance de l'agent lui-même, mes autres projets, les bulletins de sécurité.

## Conséquences

- `npm audit` envoie la liste des dépendances au registre npm, `tailscale version --upstream` et `softwareupdate` interrogent leurs éditeurs : aucune donnée personnelle (registre, services tiers).
- Les constats ne contiennent aucune donnée de personne (paquets, réglages du Mac) ; ils ont malgré tout leurs durées : 365 jours après la clôture, 90 jours pour un risque accepté.

## Options écartées

- **Un agent qui corrige seul** : contraire à la charte, et un agent avec `sudo` est une porte.
- **Des commandes proposées par le modèle** : un avis ou un flux piégé pourrait lui en souffler une.
- **Une alerte à chaque passage** : du bruit ; seul ce qui change est dit, le reste attend le bilan du lundi.
