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
5. **Une ronde, puis les messages** (révisé le 2026-10-10, sur le modèle de la ronde de Legion : un passage par jour retardait un constat de 24 à 48 heures, l'anti-rebond exigeant deux passages) : une **ronde toutes les 15 minutes** (launchd, `StartInterval`) fait les contrôles locaux (FileVault, pare-feu, SIP, Gatekeeper) ; les contrôles réseau (mises à jour, Tailscale, npm) au plus **une fois par heure** ; un contrôle qui ne tourne pas lors d'une ronde ne ferme rien. Un nouveau constat **critique parle tout de suite**, à toute heure ; un **élevé** tout de suite **hors des heures calmes** (22 h - 7 h, Paris) ; le reste attend le **rapport du matin**, envoyé par la première ronde après 7 h 30, une fois par jour ; le lundi, le bilan l'accompagne. `/etat` dit quand a eu lieu la dernière ronde, et le signale au-delà de trois rondes manquées (surveiller le surveillant). `npm run securite -- constats` et `-- accepter <n°> <raison>`. Programme à part, qui ne détient que le jeton Telegram ; une ronde à la fois (verrou d'instance).
6. **L'agent ne corrige jamais rien lui-même** (charte, règle 1). Le journal ne reçoit que des nombres.

## J6b — décider depuis Telegram (2026-10-10)

Sous chaque nouveau constat, et sous `/constats`, trois boutons : **✅ je m'en occupe** (« pris en charge », suivi jusqu'à ce qu'un contrôle le voie corrigé ; le bilan du lundi le rappelle au-delà de 7 jours), **☑ garder le risque** (le bot demande la raison, prise seulement en réponse directe à sa question, dans les 10 minutes), **❌ refuser** (se tait pour cette occurrence, redemandé 30 jours après la décision).

- Seuls mon compte et ma conversation privée sont entendus ; tout autre appui est ignoré, journalisé sans dire qui.
- Chaque constat offert porte un **jeton aléatoire à usage unique** : la décision ne s'applique qu'avec lui, et seulement à un constat encore à traiter, vérifié et écrit en une seule instruction — un bouton forgé, rejoué, d'un vieux message, ou un double appui ne change rien.
- La décision est écrite **avant** toute réponse ; si Telegram ne peut pas modifier le message, rien n'est perdu.
- Une panne de la base pendant un appui ne fait pas tomber le bot (comme en #75) : rien n'est décidé, et c'est dit.
- Aucune IA dans une décision ; le journal reçoit la sorte de décision, rien d'autre ; l'identifiant de ma conversation n'est pas gardé.

## Paliers à venir

- **J6c** — les actions débloquées par mon accord : une correction de code préparée sur une branche, avec une PR et la CI, la fusion restant à moi (accès GitHub à décider) ; les réglages du Mac restent à moi (jamais de `sudo` pour un agent).
- **J6d** — des délégations pour les cas simples que je nomme, dans un fichier versionné (`securite.toml`) que le CTO ne peut pas modifier : type exact, révocable, tracé, jamais pour ce qui demande un administrateur. **La délégation se gagne par un carnet de confiance** (décidé le 2026-10-10) — la récompense d'un agent qui travaille bien est l'autonomie, jamais un réentraînement du modèle (trop lourd en local, et sujet au « piratage de la récompense » : plaire à la mesure plutôt que bien faire) :
  - par agent et par type d'action, le compte des propositions faites, acceptées, refusées, corrigées après coup et annulées, tenu **à partir de mes décisions** seules — jamais de ce que l'agent dit de lui-même, et l'agent ne peut pas y écrire ;
  - un seuil fixé par moi dans `securite.toml` (par exemple dix corrections de faille npm acceptées sans retouche) : le CTO me **propose** alors la délégation de ce type ; c'est moi qui l'accorde (PR ou bouton) ;
  - la confiance se perd : une erreur, une correction annulée ou un refus suspend la délégation de ce type et la rend à mon accord ;
  - le bilan du lundi montre le carnet.
- **J6e** — la sentinelle qui surveille aussi l'agent depuis le serveur ; le serveur (bulletin en lecture seule, puis des scripts fixes posés sur le serveur, joignables par une clé restreinte à eux, déclenchés par mon accord ; un redémarrage reste toujours une question), mes autres projets, les bulletins de sécurité.

## Conséquences

- `npm audit` envoie la liste des dépendances au registre npm, `tailscale version --upstream` et `softwareupdate` interrogent leurs éditeurs : aucune donnée personnelle (registre, services tiers).
- Les constats ne contiennent aucune donnée de personne (paquets, réglages du Mac) ; ils ont malgré tout leurs durées : 365 jours après la clôture, 90 jours pour un risque accepté.

## Options écartées

- **Un agent qui corrige seul** : contraire à la charte, et un agent avec `sudo` est une porte.
- **Des commandes proposées par le modèle** : un avis ou un flux piégé pourrait lui en souffler une.
- **Une alerte à chaque passage** : du bruit ; seul ce qui change est dit, le reste attend le bilan du lundi.
