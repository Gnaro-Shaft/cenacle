# Ne pas juger une grappe qu'on vient de rejoindre (`attendre-la-grappe`)

Déménagé de Legion le 19/11/2026, **à l'identique** (ADR-0045, palier H1) ; seuls ses commentaires changent (des rôles, plus de noms). Le reste du dossier — la remise en route de la carte réseau, les scripts d'administration — est arrivé au palier H2 : voir plus bas.

## Pourquoi

Le 25/09/2026, le nœud de sauvegarde est revenu après deux heures d'absence. Trente-deux secondes plus tard, `Persistent=true` rattrapait ses passages nocturnes manqués — et les veilleurs ont jugé une grappe que corosync n'avait pas fini de reformer : MALADE, « l'invité 100 vit sur un autre nœud, hors ligne ». Ce nœud allait parfaitement bien ; relancés vingt minutes plus tard, les veilleurs rendaient SAIN.

**Le coût n'était pas l'alerte, c'était sa durée** : le passage suivant étant à 04:00, la fausse alerte aurait tenu trois heures et se serait lue au réveil comme un vrai problème. `Persistent=true` n'est pas en cause : sans lui, une machine éteinte la nuit ne rattraperait jamais sa copie. Le défaut était de juger, pas de rattraper.

## Il rend toujours zéro

Sortir en erreur ferait échouer l'unité, et **un veilleur en échec est un veilleur qui ne veille pas** : on échangerait une fausse alerte contre un silence. Si le quorum ne revient pas en deux minutes, le veilleur juge quand même **et dit vrai** : la grappe est cassée. Une machine sans `pvecm` (hors grappe) n'attend rien. **Il cherche `pvecm`, il ne le devine pas** : codé en dur à `/usr/sbin`, il vivait dans `/usr/bin` sur Proxmox 8, et le garde-fou était inerte.

## Poser

`ExecStartPre=/usr/local/bin/attendre-la-grappe` est dans `copie-dumps.service` et `veiller-les-sauvegardes.service` (et dans `copie-bases.service`, qui part avec Legion). Sur le nœud de sauvegarde, depuis la copie `rsync` de `deploy/homelab` :

```
install -m 755 -o root -g root ~/cenacle-homelab/homelab/grappe/attendre-la-grappe /usr/local/bin/
```

## Éprouver

Le harnais de Legion, gardé tel quel (`eprouver-attente.sh`, 11 épreuves, un faux `pvecm`), est lancé par `packages/homelab/src/sauvegardes.adversarial.test.ts`. Sur le nœud, après un passage : `journalctl -u veiller-les-sauvegardes -n 20 | grep attendre-la-grappe` doit dire `quorum apres N s` — **« aucun pvecm trouvé » sur un nœud de la grappe veut dire que le garde-fou est inerte.**

---

# Le reste de la grappe (palier H2)

Déménagé le 19/11/2026 (ADR-0045). Aucun vrai nom dans le code : les commentaires d'usage parlent de `<noeud>` et de `<rebond>`, et `poser-rebranchement` prend les deux en arguments. Legion n'avait aucune épreuve pour ces fichiers : `packages/homelab/src/rebranchement.adversarial.test.ts` et `grappe-admin.adversarial.test.ts` les éprouvent, dans un Debian jetable, sur une racine et des commandes factices.

## Le rebranchement de l'adaptateur USB (`rebranchement/`)

Le nœud portable n'a qu'un adaptateur Ethernet USB. Le 25/09/2026, fermer le capot l'a déconnecté puis reconnecté : il est revenu **hors du pont `vmbr0`**, et la machine était injoignable. Le 22/10, il est revenu en `eth0` (renommage refusé) : udev a abandonné l'événement, et la règle n'a jamais déclenché le service.

D'où **la version du nœud, du 22/10** — plus récente que celle du dépôt de Legion, qui n'avait jamais été mise à jour ; c'est elle qui a déménagé, avec **son minuteur**, absent de Legion (relevés le 19/11) :

- `90-legion-rebrancher-nic0.rules` : à chaque (re)apparition d'une carte du pilote `cdc_ncm`, demander le service (le nom du fichier est gardé) ;
- `rebrancher-nic0.timer` : 2 min après le démarrage, puis **chaque minute** — c'est lui qui rattrape ce que udev laisse tomber ;
- `rebrancher-nic0` : trouve la carte **par son pilote** et la renomme `nic0` si elle revient sous un autre nom ; relance **une fois** `ifreload -a` si le pont manque ; remet la carte dans le pont, l'active, et **relit** le résultat : `ok : nic0 dans vmbr0, activee`, ou une sortie en erreur qui dit pourquoi — jamais un échec silencieux.

**Poser**, depuis le Mac, à la racine du dépôt — le rebond, puis le nœud (`root@` son adresse) :

```
deploy/homelab/grappe/poser-rebranchement root@<rebond> root@<noeud>
```

Il copie les quatre fichiers, les installe, recharge udev et systemd, active le minuteur, et prouve que la règle reconnaît le vrai adaptateur (`udevadm test`) et que le service conclut. L'épreuve réelle reste humaine : fermer le capot, et que la machine réponde.

## Les scripts d'administration

Lancés à la main, **sur** le nœud, par `ssh … 'bash -s' < script` (en rebond pour un nœud hors du tailnet) ; jamais installés.

- `depot-sans-abonnement` : passe le nœud sur `pve-no-subscription` (le 25/09, aucun nœud ne recevait de mise à jour de Proxmox) ; désactive les dépôts *enterprise* sans les supprimer, en garde une copie, puis prouve qu'`apt-get update` passe et que `pve-manager` est proposé. Refuse sans la clé de signature de Proxmox.
- `mettre-a-jour-un-noeud appliquer` puis, après **ton** redémarrage, `… retour` : refuse sans quorum, avec un `dpkg` interrompu ou un `needrestart` qui relancerait des services ; met à jour détaché de la session ssh (`systemd-run`) ; au retour, exige le nouveau noyau, le quorum, et chaque invité `onboot` en marche.
- `ignorer-le-capot` : le portable-hyperviseur ne dort jamais (logind ignore le capot, la veille est masquée), et le prouve.

