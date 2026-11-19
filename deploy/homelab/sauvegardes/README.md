# La veille des sauvegardes (`veiller-les-sauvegardes`)

Constater que la tâche `vzdump` a eu lieu, et qu'elle a réussi. Déménagé de Legion le 19/11/2026, **à l'identique** (ADR-0045) ; ses raisons viennent de l'ADR-025 de Legion. Le script n'a aucun vrai nom et rien à configurer : il interroge la grappe en lecture seule (`pvesh`). Seuls changent ses commentaires (des rôles, plus de noms), et ses épreuves (les mêmes, des nœuds fictifs, lancées par vitest).

## Le problème

Proxmox sait signaler un échec : la tâche porte `mailnotification=failure` et une adresse. **Éprouvé le 18/09/2026, ce canal ne fonctionne pas** — et n'a jamais fonctionné : pas de `relayhost`, remise directe, **port 25 sortant bloqué**, cinq jours dans la file, puis un rebond vers un root que personne ne lit. Personne ne s'en était aperçu : rien n'avait jamais échoué.

## Ce qui remplace le courrier

`veiller-les-sauvegardes.py` et son minuteur quotidien, sur le nœud de sauvegarde, écrivent `/var/lib/veiller-sauvegardes/verdict` au format commun. Le bulletin de Cénacle le récite (`sauvegarde.veiller-sauvegardes.*`, ADR-0043) — son état, son heure, le **nombre** de ses motifs, jamais leur texte.

## Ce qu'il juge

- La tâche est-elle **activée** ? Sinon, alerte.
- Pour chaque nœud portant un invité du périmètre : la dernière tâche `vzdump` **terminée**, son statut et sa date.
- Un statut autre que `OK` ⇒ alerte **immédiate, sans seuil d'âge**.
- Rien depuis plus de **dix jours** ⇒ alerte (le même seuil que la copie).
- **Ce qu'il ne peut pas juger est une alerte**, jamais un blanc-seing : un invité sur un nœud hors ligne, un invité introuvable, une tâche au périmètre illisible, un nœud aux tâches illisibles.

Il passe à **04:00**, après la tâche du samedi (02:00) et après les copies : quand il juge, tout ce qu'il juge a eu lieu. Avant de juger, son unité attend le quorum de la grappe (`attendre-la-grappe`, dans `../grappe/`).

## Poser

Aux mêmes chemins qu'au temps de Legion — depuis le Mac, `rsync -a deploy/homelab <compte>@<nœud>:cenacle-homelab/`, puis, sur le nœud de sauvegarde :

```
install -m 755 ~/cenacle-homelab/homelab/sauvegardes/veiller-les-sauvegardes.py /usr/local/bin/
install -m 644 ~/cenacle-homelab/homelab/sauvegardes/veiller-les-sauvegardes.{service,timer} /etc/systemd/system/
systemctl daemon-reload
```

Le minuteur est déjà activé depuis Legion.

## Éprouver

Les 18 épreuves de Legion (`test_veille_sauvegardes.py`, pytest, sur une grappe de comédie) sont gardées à côté du script ; `packages/homelab/src/sauvegardes.adversarial.test.ts` les lance dans un Debian jetable, puis fait lire au vrai bulletin le verdict d'une grappe fausse, saine puis en échec. Sur le nœud, la chaîne réelle sans toucher à la tâche : `SAUVEGARDES_PEREMPTION=1 /usr/local/bin/veiller-les-sauvegardes.py` doit rendre MALADE, puis le passage ordinaire SAIN.

## Ce que ce dispositif ne fait pas

- **Il ne distingue pas une sauvegarde planifiée d'une sauvegarde manuelle** : une sauvegarde lancée à la main masquerait un planificateur arrêté.
- Il ne dit pas qu'un dump **restaure**, seulement qu'une tâche a réussi.
- Il ne surveille ni le quorum de la grappe, ni l'espace disque des nœuds.
- Il ne répare rien et ne déclenche aucune sauvegarde : il constate.
