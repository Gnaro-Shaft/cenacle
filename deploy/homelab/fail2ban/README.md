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

Une ronde interroge ces machines : un incident d'authentification la ferait bannir, et la surveillance s'arrêterait sur la machine même qu'elle surveille. Au 19/11, les listes diffèrent — le VPS du bot ignore le Mac (sur le tailnet), le VPS du site public ignore la box (la ronde de Legion en sort). Les aligner est une amélioration, à faire à part.

**À revoir si l'adresse de la box change.** Rien ne la mettra à jour tout seul, et rien ne criera : on s'en apercevra le jour où la ronde dira « injoignable ».

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

`packages/homelab/src/fail2ban.adversarial.test.ts` éprouve le tout sur le vrai fail2ban, dans un Debian jetable : la configuration réellement chargée (avec les réglages par défaut de Debian 12, là où le piège existe), chaque refus de `poser-fail2ban`, le retour de l'ancien `jail.local`, et les verdicts de l'épreuve.

## Ce que ça change pour la ronde

Les refus SSH ont chuté à la pose (24/09 : 387 refus / 30 sources par heure sur le VPS du bot, 150 / 22 sur celui du site public). La ronde de Cénacle ne récite ni ces compteurs ni ceux de fail2ban : ils portent sur des adresses de tiers (ADR-0040).
