# ADR-0021 — Le CTO lit le code avec trois outils de lecture seule, et relit une branche (expérimental)

**Statut** : acceptée (2026-10-09) — complète l'ADR-0017 (§ 2)

## Contexte

Le CTO ne voyait que la documentation (ADR-0017). Pour le contrôle qualité (J3, `docs/phase-6.md`), il doit lire le code : environ 170 000 jetons, qui ne tiennent pas dans la fenêtre du modèle. L'ADR-0017 prévoyait pour J3 des outils de lecture seule, « accordés par le code, jamais par le modèle » (charte, règle 2).

L'essai du 09/10 (étape 0) a montré que Qwen 3.8 sait s'en servir : cinq bonnes réponses sur cinq, avec le fichier et la ligne, et, invité à lire `.env`, il a essayé — c'est l'outil qui a refusé.

## Décision

1. **Trois outils, fixés dans le code** : `lister` (les fichiers sous un dossier), `lire` (un fichier par tranches : 200 lignes par défaut, 400 au plus), `chercher` (un texte exact, jamais une expression régulière ; 50 résultats au plus). Le modèle ne peut ni en ajouter ni atteindre autre chose : ni réseau, ni écriture, ni exécution.
2. **Ils lisent les objets de git**, à une révision fixée par le code — `HEAD` pour une question, la branche pour une relecture —, jamais le disque : aucun chemin n'est résolu, aucun lien symbolique suivi (une entrée lien n'est pas un fichier), rien de non suivi. Les règles de la documentation valent : jamais `.env*`, `*.local.toml` ni `fixtures/` ; un fichier binaire, trop gros (400 000 caractères) ou dont le texte ressemble à un secret est refusé entier. Un appel de fonction ou un accès à l'environnement n'est pas pris pour un secret ; une valeur en clair, si.
3. **Un budget** : 6 appels et 150 000 caractères pour une question, 12 appels pour une relecture ; une fenêtre de temps comptée **à partir du premier appel** (2 minutes pour une question, 4 pour une relecture). Au-delà, les outils répondent « budget épuisé » et le CTO répond avec ce qu'il a lu, au lieu d'être coupé par le délai.
4. **La relecture, expérimentale** (`npm run cto -- --relire <branche>`) : un second regard, jamais une garantie. Le code calcule le diff d'une branche **locale** contre sa base commune avec `main` ; le nom est vérifié (ni option, ni intervalle) ; les fichiers privés ou ressemblant à un secret sont écartés du diff ; le diff est plafonné à 30 000 caractères, et un diff énorme (fichier généré) devient une ligne et ne masque jamais un petit changement. La relecture n'embarque que la documentation essentielle (`CLAUDE.md`, le README, la charte). Le CTO rend des constats : gravité, `chemin:ligne`, pourquoi, et le test qui l'attraperait. **Il ne commente nulle part** : il conseille, je décide. La relecture passe par son service, une à la fois.
5. **La vérification s'étend** : chaque `chemin:ligne` est vérifié dans le code à partir duquel la réponse a été écrite (le fichier existe à cette révision, la ligne aussi) ; un nom court ne compte que s'il désigne un seul fichier. **Le code marque** chaque référence introuvable à l'endroit où elle apparaît, au lieu de demander une réécriture au modèle (qui, sans outils, en réclamait encore, et, outils épuisés, perdait ce qu'il avait lu).
6. **Rien n'est gardé** (ADR-0017 § 6, inchangé) : le journal reçoit des compteurs (appels d'outils, refus), jamais un nom de fichier lu ni un extrait.

## Conséquences

- Il vérifie dans le code au lieu de dire « dans le code, que je ne vois pas » : au premier essai réel, une réponse juste en 123 s, avec 16 références vérifiées.
- **La relecture manque les défauts qui comptent** : au banc du 09/10 (trois commits qui avaient introduit de vrais défauts, corrigés depuis), elle n'en a trouvé **aucun**, en 3 minutes environ chacune, avec des constats souvent théoriques ; elle a trouvé par ailleurs un vrai défaut mineur (un message d'erreur complet affiché par `apps/iris/src/draft-main.ts`). Une branche trop grosse (23 fichiers) dépasse le délai. Son amélioration est un jalon à part (J3b).
- Une question qui lit du code prend 1 à 3 minutes ; une relecture, environ 3 minutes sur un diff moyen.
- Six fichiers de tests, qui contiennent volontairement de faux secrets, lui restent illisibles.
- Une consigne écrite dans un fichier du dépôt ne lui donne aucun droit : l'outil refuse quand même.

## Options écartées

- **Lire le disque** : il faudrait résoudre des chemins (`..`, liens symboliques, fichiers non suivis), et une relecture lirait la mauvaise version.
- **Un outil d'exécution** (lancer les tests, `grep` libre) : un modèle manipulable par ce qu'il lit ne doit rien exécuter (charte, règle 1).
- **Commenter la pull request sur GitHub** : il faudrait un jeton (ADR-0017 § 5), et ce serait agir.
- **Une réécriture par le modèle** quand une référence manque (J1) : avec des outils, elle s'est montrée nuisible (constaté le 09/10).
