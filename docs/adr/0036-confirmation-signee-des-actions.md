# ADR-0036 — Ma confirmation d'une action sur un serveur est tenue par construction

**Statut** : acceptée (2026-11-13) — la signature seule, retenue par le responsable parmi trois options ; complète l'ADR-0027 et l'ADR-0035, sur le modèle de l'ADR-0013

## Contexte

L'ADR-0027 veut qu'aucune action ne parte sur un serveur sans mon bouton, confirmé. L'ADR-0035 étend cette confirmation à un plan entier. Aujourd'hui, cette règle est tenue **par le code** du bot et de l'opérateur, pas par la base. C'est la situation que l'ADR-0013 a corrigée pour les mails, et qui n'a pas été reportée ici.

Constaté à l'audit du 13/11, à la lecture des migrations et des magasins :

- **Un seul rôle pour presque tout.** Iris, le CTO, la veille, la prospection, la page, le bot, l'agent sécurité et l'opérateur se connectent tous avec `cenacle_app`. Ce rôle a `SELECT, INSERT, UPDATE, DELETE` sur `serveur_actions`, `maintenance_plans`, `maintenance_etapes` et `securite_constats`.
- **Aucun déclencheur sur ces tables.** Les contraintes vérifient qu'une ligne est cohérente, pas qui l'a écrite. Une ligne `serveur_actions` en état `confirmee` s'insère directement ; un plan passe à `confirmee` par un simple `UPDATE`.
- **Les jetons de confirmation sont lisibles.** Ils sont rangés en clair dans ces tables, que tous ces programmes peuvent lire : le jeton protège d'un double appui, pas d'un programme.
- **Les étapes d'un plan ne sont pas figées.** Rien n'empêche d'ajouter une étape à un plan déjà confirmé.
- **La fusion d'une PR suit le même chemin** : `securite_constats.action_state = 'fusion_demandee'` s'écrit sans mon appui.

Ce qui borne le dégât aujourd'hui : l'opérateur revérifie tout avant d'agir (l'interrupteur, la machine, sa clé, un relevé de Legion de moins de 35 minutes qui montre encore le motif, un redémarrage par 24 heures, et depuis le 13/11 une confirmation de moins de 15 minutes), et les scripts du serveur gardent leurs propres refus. Le pire cas est donc **une action du catalogue, non voulue par moi, sur une machine qui en montrait déjà le motif**. Ce n'est pas une exécution arbitraire. C'est tout de même un redémarrage que je n'ai pas demandé.

Qui peut l'écrire : un défaut du code, ou une dépendance compromise, dans n'importe lequel de ces programmes. Les plus exposés lisent du contenu écrit par des inconnus : Iris (les mails), la veille (des flux publics), la prospection (les alertes des plateformes). Aucun modèle n'a d'outil pour écrire en base (règle 1 de la charte) : le risque vient du processus, pas du modèle.

## Décision

**Ma confirmation est signée par le bot, et vérifiée par celui qui exécute.** C'est le mécanisme de l'ADR-0013, appliqué aux gestes confirmés sur Telegram.

1. **Le bot signe en Ed25519 ce que je confirme**, au moment de mon appui sur « Confirmer » :
   - pour une action : `cenacle-confirm-v1 · n° de l'action · machine · action · n° du constat · instant de la confirmation` ;
   - pour un plan : `cenacle-plan-v1 · n° du plan · empreinte SHA-256 de ses étapes non retirées (rang, machine, action, « s'il le faut ») · instant de la confirmation`.
   La signature est rangée avec la ligne. La **clé privée** n'est donnée qu'au bot (un fichier `.env.bot` que lui seul charge) ; la **clé publique** est dans la configuration de l'opérateur.
2. **L'opérateur vérifie avant d'agir.** Sans signature valide pour *cette* action sur *cette* machine, il refuse : refus nommé `confirmation_non_signee`, dit sur Telegram, journalisé. Pour une étape de plan, il vérifie la signature du plan, recalcule l'empreinte des étapes et s'assure que l'action à lancer est bien l'étape en cours de ce plan. Une étape ajoutée après ma confirmation change l'empreinte : le plan s'arrête.
3. **La base fige ce qui est confirmé.** Un déclencheur refuse tout changement de la machine, de l'action ou du rang d'une étape, et tout ajout d'étape, dès que le plan n'est plus « proposé » ou « à confirmer ». C'est le pendant des états clos de l'ADR-0013. **Précision à la mise en œuvre (2026-11-13)** : la règle est plus stricte que ce texte, pour que la liste que je lis soit celle que je signe. Une étape ne s'ajoute que tant que le plan est « proposé », plus du tout une fois que la question de confirmation m'a été posée ; elle ne change jamais de plan, de rang, de machine, d'action ni de condition ; une étape retirée ne revient jamais ; et rien ne se retire après ma confirmation.
4. **La fusion d'une PR suit, dans un second palier.** Le bot signe `PR · empreinte du commit de tête · instant` ; l'agent sécurité vérifie avant `gh pr merge`. Même clé, même contrôle.
5. **Aucune donnée personnelle nouvelle.** Une signature porte sur des noms de machines, des numéros et des dates.
6. **Tests adversariaux exigés** :
   - une action écrite `confirmee` sans le bot n'est pas exécutée ;
   - la signature d'une action, recopiée sur une autre machine ou une autre action, est refusée ;
   - une étape ajoutée, ou dont la machine a changé, après ma confirmation : refusée par la base, et le plan arrêté par l'opérateur ;
   - une signature valide mais vieille de plus de 15 minutes reste refusée (révision de l'ADR-0027 du 13/11) ;
   - l'opérateur refuse de démarrer avec la clé privée ; le bot est le seul à la charger.

## Conséquences

- La garantie « rien ne part sans ma confirmation » ne dépend plus du rôle en base ni du contenu des tables : elle dépend de **qui détient la clé privée du bot**.
- **Limite assumée**, la même que l'ADR-0013 : sur un Mac à utilisateur unique, un programme qui tourne sous mon compte peut lire tous mes fichiers, clé comprise. La décision protège contre un défaut ou une dépendance compromise **dans un processus**, pas contre la prise de mon compte macOS ni de mon compte Telegram.
- **Ce qu'elle ne couvre pas** : un programme peut toujours abîmer ces tables (effacer une ligne, marquer une action « refusée »). Il empêche alors une action, il n'en déclenche aucune. Les faux événements au journal (un faux `stop.requested`, un faux `purge.done`) restent possibles : c'est l'objet du complément ci-dessous.
- **Au déploiement** : une action confirmée mais pas encore exécutée sera refusée, et dite. La fenêtre est d'au plus 15 minutes.
- **Rotation de la clé** : même procédure que pour la page, à écrire dans `docs/securite/secrets.md` ; la clé entre dans la sauvegarde chiffrée des secrets.
- **Travail** : une migration (colonnes de signature, déclencheur des étapes), la signature dans le bot, la vérification dans l'opérateur, une famille de secrets de plus (`.env.bot`), la commande qui tire la paire de clés, les tests. Un jalon ; le second palier (fusion) en est un petit.

## Alternatives écartées

- **Des rôles séparés en base, sans signature.** Un rôle `cenacle_bot`, seul autorisé par déclencheur à passer une ligne à « confirmée » ; un rôle `cenacle_operateur`, seul autorisé à la prendre et à la clore — comme `cenacle_executor` pour l'envoi (migration 009). Aussi fort pour savoir *qui* confirme, et cela empêcherait en plus les autres programmes d'abîmer ces tables. Mais cela ne lie pas le contenu confirmé sans déclencheurs supplémentaires, cela demande deux mots de passe de plus et un fichier d'environnement par programme, et le propriétaire de la base garde tout pouvoir.
- **La signature, puis les rôles, en deux temps** (ce qu'a fait l'ADR-0013 : la signature en B6, le rôle de l'exécuteur en B7). **Différé, pas écarté** : le second temps réglerait aussi les faux événements au journal. Il se décidera quand chaque programme aura son propre rôle en base ; ce sera un autre ADR.
- **Des déclencheurs sans rôle séparé ni signature.** Le rôle applicatif lit le jeton de confirmation dans la table : il satisfait lui-même la condition que le déclencheur vérifierait.
- **Une signature HMAC partagée** entre le bot et l'opérateur. L'opérateur, qui détient les clés des serveurs, pourrait alors fabriquer une confirmation. Ed25519 ne lui donne que le pouvoir de vérifier.
- **Chiffrer ou hacher les jetons en base.** Cela corrige la lecture du jeton, pas l'écriture directe de l'état « confirmée ».
- **Le statu quo, borné par les revérifications de l'opérateur.** Elles limitent le dégât, elles ne disent pas que j'ai voulu l'action.
