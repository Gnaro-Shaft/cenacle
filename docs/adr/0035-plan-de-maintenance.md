# ADR-0035 — Le plan de maintenance : un récapitulatif, une validation, des gestes enchaînés

**Statut** : proposée (2026-10-26) — révise l'ADR-0027 (point 3 et palier J6f3 : « chaque geste reste séparé et confirmé ») ; garde tout le reste de l'ADR-0027 : catalogue fermé, une clé par action, garde-fous sur le serveur, revérification, preuve

## Contexte

Depuis l'ADR-0027, Cénacle sait, sur mon bouton confirmé, appliquer les mises à jour de sécurité (⬆), relancer les services sur une bibliothèque remplacée (🔁) et redémarrer une machine (🔄). Quatre machines en sont équipées depuis le 2026-10-26 : les deux VPS (la sentinelle et le site) et les deux nœuds de la grappe.

À l'usage, trois limites :

- **Geste par geste.** Une mise à jour du noyau me coûte trois appuis et trois confirmations, espacés de plusieurs relevés de Legion : ⬆, puis, quand le constat apparaît, 🔁, puis 🔄. Pour quatre machines, c'est une demi-journée de va-et-vient. Le dirigeant veut (2026-10-26) **être informé en continu de la maintenance à faire et l'automatiser, avec sa validation**, sans lancer de commandes lui-même.
- **Les mises à jour de Proxmox sont invisibles.** Elles ne viennent pas de l'origine « security » : la ronde de Legion ne les juge pas (sa règle ne regarde que `maj.securite`), donc aucun constat, donc aucun bouton. Le bulletin, lui, les compte déjà (`maj.total`).
- **La preuve du 🔁 se trompe sur les services épargnés.** Sur le VPS du site, le 2026-10-26, le 🔁 a tout relancé de ce qu'il avait le droit de relancer ; il restait cinq services épargnés par principe (`ssh`, `dbus`, `systemd-logind`, `systemd-networkd`, `systemd-manager`), plus que les trois du relevé d'avant : la preuve a dit « toujours là ». Legion ne donne qu'un nombre, sans les noms.

Legion a déjà un script éprouvé pour mettre à jour un nœud Proxmox (`deploiement/grappe/mettre-a-jour-un-noeud`, phase « appliquer ») : on le porte plutôt que de le réinventer (Cénacle remplacera Legion).

## Décision

1. **Un récapitulatif de maintenance, sans modèle.** Une fois par jour, par la première ronde de l'agent sécurité après **9 h** (même mécanique que le bilan du matin, ADR-0025), et à la demande par `/maintenance`, un seul message Telegram : pour chaque machine qui a quelque chose à faire, la suite d'étapes que ses constats appellent. Rien à faire nulle part : pas de message (`/maintenance` répond « rien à faire »).
   - Les étapes se déduisent **des types de constats**, par une table écrite dans le code, comme le catalogue de l'ADR-0027. Aucun modèle ne compose, ne choisit ni n'ordonne une étape (charte, règle 1).
   - Exemple : « noeud-a : ⬆ complète → 🔁 s'il le faut → 🔄 s'il le faut (à vider d'abord : 2 invités) ».
   - Une étape n'est proposée que si l'action est déclarée pour la machine dans `serveurs.local.toml` (une clé). Sinon, la ligne dit « à faire à la main ».

2. **Les étapes conditionnelles sont validées d'avance.** Une mise à jour fait souvent apparaître, après coup, des services à relancer ou un redémarrage demandé. La ligne d'une machine porte donc la suite complète : ⬆, puis 🔁 **si** le relevé le demande alors, puis 🔄 **si** le relevé le demande alors. C'est ce point qui révise l'ADR-0027 : ces gestes ne sont plus confirmés un à un, mais **validés ensemble, d'avance, par moi**.

3. **Une validation, confirmée, et le redémarrage à part.**
   - Sous le récapitulatif : ✅ **Valider le plan**, et, pour chaque machine où un 🔄 est possible, **Retirer 🔄 de <machine>**. Le redémarrage n'est jamais noyé : c'est une ligne que je vois et que je peux retirer.
   - Mon appui ne lance rien : comme aujourd'hui, le bot demande **« Confirmer le plan ? »**, second bouton à usage unique, valable **2 minutes**.
   - **Un plan validé vaut 6 heures** : toute étape qui n'a pas commencé dans ce délai est annulée, et me le dit. L'état des machines a pu changer.
   - **Un seul plan à la fois.** Un nouveau récapitulatif n'en remplace pas un en cours d'exécution.

4. **L'opérateur enchaîne, une étape à la fois.** Chaque étape devient une action ordinaire de l'ADR-0027 (table `serveur_actions`), exécutée par le même chemin et soumise aux mêmes règles : une seule action à la fois, toutes machines confondues ; au plus un redémarrage par machine et par 24 heures.
   - **Ordre des machines** : celui des blocs de `serveurs.local.toml` (ignoré par git ; aujourd'hui la sentinelle, le site, puis les deux nœuds). Une machine est finie (dernière étape prouvée, ou sautée) avant que la suivante commence.
   - **Avant chaque étape, il revérifie** (charte, règle 5) sur un relevé de Legion de moins de 35 minutes. Motif encore là : l'étape part. Motif disparu, ou jamais apparu pour une étape conditionnelle : l'étape est **sautée**, ce n'est pas un échec.
   - **Il attend la preuve** d'une étape (point 5 de l'ADR-0027) avant de lancer la suivante.
   - **Les deux nœuds de la grappe ne redémarrent pas dans la même foulée** : le 🔄 du second n'est tenté que si le premier est prouvé revenu et la grappe à nouveau au complet sur le relevé. Le script le refuserait de toute façon (quorum) ; l'opérateur ne le tente pas.

5. **Au premier accroc, tout s'arrête.** Un refus du script, un échec (code 12), un état inconnu, une preuve « toujours là », une machine qui ne revient pas : le reste du plan est annulé, toutes machines. Le message dit où il s'est arrêté, pourquoi (la règle qui a refusé, s'il y en a une), et ce qui a été fait avant. Une machine non revenue reste l'alerte critique de l'ADR-0027.

6. **Une action nouvelle, pour Proxmox : `cenacle-maj-complete`.** Le portage de la phase « appliquer » du script de Legion, sur le modèle de `cenacle-maj-securite` :
   - lance `apt-get dist-upgrade` (configurations existantes gardées, `--force-confold`) **en tâche de fond**, dans l'unité `cenacle-maj` : une coupure de la connexion n'interrompt jamais `dpkg` ;
   - **ne redémarre jamais** ;
   - refuse si la grappe n'a pas son quorum, si `dpkg` n'est pas propre, si `needrestart` n'est pas réglé en liste seule, si une mise à jour tourne déjà, ou sous 1 Go libre ;
   - sa propre clé, `command=` verrouillé comme les autres ; déclarée pour les nœuds Proxmox seulement. Sur les VPS, les mises à jour de sécurité automatiques restent la règle (sur le site : mises à jour automatiques, redémarrage à mon bouton — réglé le 2026-10-26 ; sur la sentinelle : Ubuntu).
   - **La détection** passe par Legion : une PR dans son dépôt ajoute à la copie du verdict le nombre de mises à jour en attente par machine (`<machine>.maj.total`), **comme une information, pas comme un motif** — sinon toutes les machines seraient « SOUFFRANT » en permanence. L'agent sécurité en fait un constat `serveur_maj` (moyen). Preuve : relevé d'au moins 10 minutes après, plus rien en attente ; encore en attente 2 heures après : dit une fois.

7. **La preuve du 🔁 connaît les épargnés.** `cenacle-services` écrit, en plus de son code de sortie, une seule ligne `epargnes=<n>` (0 à 99) : le nombre de services de la liste de `needrestart` qu'il a laissés par principe. L'opérateur la lit strictement (toute autre sortie est ignorée, la règle actuelle s'applique) et ne me la montre jamais brute. Après coup, un relevé qui compte au plus `n` services se dit **« il ne reste que les épargnés »** (`verified = 'epargnes'`, nouvelle valeur, migration), et compte comme une réussite dans un plan. Les épargnés eux-mêmes restent à moi : ils partent au prochain 🔄.

8. **Jamais délégable, aucun modèle.** Comme les actions de l'ADR-0027, un plan n'entre dans aucune délégation (ADR-0026) ; aucun agent ne valide un plan. Le récapitulatif peut être expliqué par le CTO comme tout constat, marqué « généré par IA », mais son contenu et ses boutons viennent de la table.

9. **Un interrupteur à part** : `[maintenance] actif = false` dans `securite.toml`, en plus de `[serveurs] actif`. Éteint, pas de récapitulatif ni de plan ; les boutons un par un de l'ADR-0027 restent.

10. **Tout est journalisé, compté** : récapitulatif envoyé, plan validé, confirmé, expiré, étape lancée, sautée, refusée, arrêt du plan et sa raison — des événements déclarés (`maintenance.plan`), des noms de machines, des nombres et des codes, jamais une sortie de serveur ni une adresse.

## Paliers

- **J7a** — cet ADR, pour relecture.
- **J7b** — la preuve du 🔁 (point 7) : la ligne `epargnes=` du script, sa lecture, la valeur `epargnes`. Indépendant du reste, utile tout de suite ; à reposer sur les quatre machines (`rsync` + `install.sh`).
- **J7c** — le récapitulatif seul (points 1 et 2) : message à 9 h et `/maintenance`, **sans aucun bouton d'action**. On regarde quelques jours s'il dit juste.
- **J7d** — la validation et l'enchaînement (points 3 à 5) avec les trois actions existantes ; essai réel d'abord sur une seule machine.
- **J7e** — Proxmox (point 6) : la PR Legion (`maj.total` dans la copie du verdict), le constat `serveur_maj`, `cenacle-maj-complete` et sa clé sur les deux nœuds.

## Conformité

- Aucune donnée personnelle : des noms de machines, des états, des nombres, des codes de sortie. Le registre des traitements ne change pas.
- Aucune IA dans la décision ni dans l'exécution : le registre IA ne change pas (l'explication du CTO, déjà déclarée par l'ADR-0025, reste marquée).
- Aucun nouveau tiers : Legion, Tailscale et les serveurs sont déjà là.

## Conséquences

- **Une validation par jour au lieu d'une dizaine d'appuis**, et je ne lance plus de commande pour la maintenance courante.
- **C'est lent, et c'est voulu** : chaque étape attend un relevé de Legion (15 minutes, jusqu'à 30 avec la recopie). Une machine avec ⬆, 🔁 et 🔄 prend environ une heure ; quatre machines, une demi-journée. Les 6 heures de validité le permettent ; au-delà, le reste est annulé et revient au récapitulatif du lendemain.
- **Le Mac doit rester allumé** pendant l'exécution, tant que l'opérateur y tourne (ADR-0027). Mac fermé : le plan s'arrête, l'étape en cours est dite « état inconnu » au retour.
- **Un nœud qui porte des invités** voit son 🔄 refusé : le plan s'arrête là. Le récapitulatif le dit d'avance (« à vider d'abord »), pour que je vide le nœud avant de valider.
- **Un redémarrage de l'hôte de Legion** n'est jamais dans un plan (il n'est pas déclaré dans `serveurs.local.toml`) : sans ronde, plus de preuve.
- **Une dépendance de plus envers Legion** (point 6) ; elle tombera le jour où Cénacle reprendra la ronde (ADR-0025).

## Options écartées

- **Tout automatique, sans validation** : le dirigeant veut valider ; et un redémarrage reste une décision humaine (ADR-0027, point 6).
- **Garder la confirmation étape par étape** : c'est la friction qu'on veut retirer ; les garde-fous du serveur et la revérification ne changent pas pour autant.
- **Une délégation pour les gestes « sans risque »** : les actions sur les serveurs sont hors délégation (ADR-0027, ADR-0026) ; un plan validé par moi suffit.
- **Un plan composé par le modèle** : interdit (charte, règle 1).
- **Les deux nœuds en parallèle** : un nœud de moins doit toujours laisser la grappe au complet.
- **Continuer après un accroc** : une étape qui échoue dit que l'état n'est plus celui que j'ai validé.

## Hors périmètre

- **Une fenêtre de nuit** (valider le jour, exécuter à 3 h) : attend que l'opérateur quitte le Mac pour une machine permanente.
- **Docker** (images périmées des conteneurs) : un ADR à part, détection d'abord.
- **Homebrew sur le Mac** : l'agent sécurité voit déjà `softwareupdate` ; Homebrew viendra avec les contrôles du Mac, pas avec les serveurs.
- **Arrêter et relancer les invités d'un nœud** avant un redémarrage : les disques sont locaux, pas de migration à chaud ; je vide le nœud à la main.
- **La phase « retour » du script de Legion** (invités `onboot` relancés après un redémarrage) : le bulletin ne le dit pas encore ; à reprendre quand Cénacle aura sa ronde.
