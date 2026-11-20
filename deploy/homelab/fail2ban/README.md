# fail2ban sur les VPS

Posé le 24/09/2026 sur les deux VPS par Legion ; déménagé dans Cénacle le 19/11/2026 (ADR-0045). Ils prenaient plusieurs centaines de tentatives de connexion par heure — jusqu'à 910 depuis une seule adresse — et rien ne bannissait personne.

Ce qui a changé au déménagement : **aucune adresse dans le dépôt**. `jail.local` n'ignore plus que la machine elle-même ; les adresses de chaque VPS vivent sur lui, dans `/etc/fail2ban/jail.d/ignorer.local`. La pose passe par `poser-fail2ban`, qui refuse ce que fail2ban accepterait sans rien dire. Les épreuves tournent sous vitest.

## Le piège, et pourquoi la configuration est unique

La jail `sshd` par défaut lit `/var/log/auth.log`. Sur le VPS du site public (Debian 12), **ce fichier n'existe pas** et `rsyslog` est inactif : la jail aurait tourné, `systemctl` aurait dit `active`, et elle n'aurait banni personne.

C'est le mode d'échec le plus courant de fail2ban, et le plus trompeur : il ressemble trait pour trait à un succès.

D'où `backend = systemd`, **sur les deux machines** — bien qu'Ubuntu ait le fichier. Une configuration unique se relit ; deux configurations divergent.

## Le second piège : une liste en remplace une autre

Un `ignoreip` posé dans `jail.d/` **remplace** celui de `jail.local` — il ne s'y ajoute pas, qu'il soit sous `[DEFAULT]` ou sous `[sshd]`. Et de deux fichiers de `jail.d/`, fail2ban garde le dernier lu, sans rien dire. `%(known/ignoreip)s`, qui semblerait étendre la liste, fait rejeter toute la configuration. Éprouvé sur le vrai fail2ban, le 19/11.

C'est arrivé : sur le VPS du bot, un fichier posé le 14/11 pour ne plus bannir le Mac a, du même coup, cessé d'ignorer la box. D'où **un seul fichier**, `ignorer.local`, qui porte toute la liste de son VPS — 127.0.0.1/8 et ::1 compris.

## Sans les adresses de la ronde, elle devient aveugle

Une ronde interroge ces machines : un incident d'authentification la ferait bannir, et la surveillance s'arrêterait sur la machine même qu'elle surveille. Au 19/11, les listes différaient — le VPS du bot ignorait le Mac (sur le tailnet), le VPS du site public la box (la ronde de Legion en sort). **Alignées le 20/11 : les deux VPS ignorent la machine elle-même, le Mac sur le tailnet et l'adresse publique de la box** — la ronde de Cénacle, et moi depuis la maison.

**À revoir si l'adresse de la box change.** Rien ne la mettra à jour tout seul, et rien ne criera : on s'en apercevra le jour où la ronde dira « injoignable ».

## Le mode « aggressive »

Choisi le 20/11/2026. En mode `normal`, une connexion coupée avant l'authentification (`Connection closed by authenticating user root … [preauth]`) n'est pas un échec — c'est pourtant tout ce que laissent les robots qui n'essaient que des clés. Sur 24 h du journal du VPS du site public, `fail2ban-regex` reconnaissait 110 échecs en `normal`, **1010** en `aggressive`.

Le revers : quatre connexions ratées en dix minutes, depuis une adresse qu'`ignorer.local` ne porte pas (un téléphone hors du tailnet), bannissent une heure, puis plus longtemps à chaque récidive. D'où les listes alignées, **posées avant** ce mode.

## Poser

**D'abord, sur le VPS**, la liste de ses adresses, d'après `ignorer.exemple.local` :

```bash
sudoedit /etc/fail2ban/jail.d/ignorer.local
```

Sur le VPS du bot, le fichier du 14/11 porte déjà la bonne liste : `sudo mv /etc/fail2ban/jail.d/cenacle-mac.local /etc/fail2ban/jail.d/ignorer.local` — ce que fail2ban charge ne change pas.

**Puis, depuis le Mac**, à la racine du dépôt :

```bash
deploy/homelab/fail2ban/poser-fail2ban <compte@vps>
```

Il refuse sans `ignorer.local`, s'il n'ignore que la machine elle-même, ou si un autre fichier de `jail.d/` pose un `ignoreip`. Il installe `jail.local`, redémarre fail2ban, et prouve que la jail lit le journal et ignore chaque adresse du fichier ; sinon, il remet l'ancien `jail.local`.

## Éprouver

**Que le service tourne ne prouve rien.** Ce qui compte est qu'il voie des échecs et qu'il bannisse :

```bash
deploy/homelab/fail2ban/eprouver-fail2ban.sh <compte@vps> <adresse ignorée>
```

Elle compare ce que la jail a compté **depuis le démarrage de fail2ban** — qui remet son compteur à zéro — à ce que le journal porte depuis le même instant, jugé par `fail2ban-regex` (adresses ignorées retirées) :

- la jail a compté des échecs : ok ;
- elle n'en compte aucun, le journal en porte : **ECHEC**, elle lit au mauvais endroit ;
- aucun ni d'un côté ni de l'autre : « rien à juger », code de sortie 3 — à relancer plus tard. Le 20/11, quatre minutes après une pose, l'ancien contrôle criait « AUCUN échec » sur une jail qui marchait.

Le journal est jugé en mode `normal`, quel que soit celui de la jail : chaque échec du mode `normal` en est un aussi en `aggressive` (éprouvé le 20/11 sur fail2ban 1.1). Depuis un fichier : sur Debian 12, `fail2ban-regex` plante sur `systemd-journal[journalmatch=…]`. Le journal s'arrête dix secondes avant la lecture du compteur, pour qu'un échec encore en route ne passe pas pour un échec ignoré.

Ce qu'elle suppose :

- le compteur ne repart à zéro qu'au **démarrage** du service : après un `fail2ban-client reload`, redémarrer fail2ban avant l'épreuve ;
- seules les adresses simples d'`ignorer.local` (et la boucle locale) sont retirées du journal, pas un réseau `a.b.c.d/n` — un réseau ignoré y ferait crier l'épreuve à tort ;
- le compte a `sudo` sans mot de passe pour `bash`, comme pour la pose.

`packages/homelab/src/fail2ban.adversarial.test.ts` éprouve le tout sur le vrai fail2ban, dans un Debian jetable : la configuration réellement chargée (avec les réglages par défaut de Debian 12, là où le piège existe, et le mode `aggressive`), chaque refus de `poser-fail2ban`, le retour de l'ancien `jail.local`. `fail2ban-epreuve.adversarial.test.ts` éprouve les verdicts de l'épreuve, le journal jugé par le vrai `fail2ban-regex`.

## Ce que ça change pour la ronde

Les refus SSH ont chuté à la pose (24/09 : 387 refus / 30 sources par heure sur le VPS du bot, 150 / 22 sur celui du site public). La ronde de Cénacle ne récite ni ces compteurs ni ceux de fail2ban : ils portent sur des adresses de tiers (ADR-0040).
