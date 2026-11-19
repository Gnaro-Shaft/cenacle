# Ne pas juger une grappe qu'on vient de rejoindre (`attendre-la-grappe`)

Déménagé de Legion le 19/11/2026, **à l'identique** (ADR-0045, palier H1) ; seuls ses commentaires changent (des rôles, plus de noms). Le reste du dossier `grappe/` de Legion — la remise en route d'une carte réseau, les scripts d'administration — vient au palier H2.

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
