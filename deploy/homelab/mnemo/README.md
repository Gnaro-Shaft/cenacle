# Mnemo et Ollama, fermés au réseau local

Mnemo n'est pas un projet de Cénacle : c'est la recherche en langage naturel sur le coffre Obsidian, qui tourne sur **la machine de Mnemo** (un conteneur de la grappe). Ce dossier ne porte que la **configuration de son déploiement** : la ronde de Legion l'a révélée le 25/09/2026, Legion l'a posée, et elle a déménagé dans Cénacle le 20/11/2026 (ADR-0045, point 5), faute d'un dépôt de Mnemo où la mettre. Elle en sortira si Mnemo en prend un.

Ce qui a changé au déménagement : **aucune adresse ni aucun nom de machine dans le dépôt**. `ecoute-tailnet.conf` est un modèle : le script remplace `@TAILNET@` par ce que la machine répond à `tailscale ip -4`, et refuse ce qui n'est pas une adresse du tailnet. Les deux machines sont ses arguments. Les réglages posés sont ceux de Legion, à l'identique.

## Ce qui était ouvert

Relevé le 25/09/2026, port par port :

| Service | Port | Authentification | Écoutait sur |
|---|---|---|---|
| mnemo-mcp | 8001 | **aucune** | toutes les interfaces |
| mnemo-api | 8000 | clé `X-API-Key` | toutes les interfaces |
| métriques du MCP | 8002 | aucune | toutes les interfaces |
| Ollama | 11434 | aucune | toutes les interfaces (`OLLAMA_HOST=0.0.0.0`) |

**Le MCP n'a pas d'authentification, et son code l'assume** : « Tailscale fait l'isolation réseau ». Mais il écoutait sur `0.0.0.0`, valeur par défaut du code — l'isolation n'avait pas lieu. Toute machine du réseau local pouvait interroger le coffre Obsidian : des **notes personnelles**, en langage naturel. L'hypothèse de sécurité du code n'était pas celle du déploiement.

## Ce qui est posé

| Service | Écoute désormais sur | Parce que |
|---|---|---|
| mnemo-mcp, mnemo-api, métriques | l'adresse du tailnet de la machine | Claude Desktop y passe déjà (`mcp-remote`, port 8001) |
| Ollama | `127.0.0.1` | ses 217 requêtes de la semaine venaient toutes de la machine elle-même |

- `ecoute-tailnet.conf`, rempli → `/etc/systemd/system/mnemo-{api,mcp}.service.d/`
- `ollama-override.conf` → remplace `/etc/systemd/system/ollama.service.d/override.conf`
- dans `/root/projects/mnemo/.env` : `MNEMO_OLLAMA_URL=http://127.0.0.1:11434`, et droits en `600`.

Chaque fichier remplacé est gardé à côté, en `*.bak-avant-<date>`. Le contenu du `.env` n'est jamais affiché.

## Poser, et le prouver

Depuis le Mac, à la racine du dépôt :

```bash
deploy/homelab/mnemo/fermer-au-reseau-local <root@machine-de-mnemo> <compte@témoin>
```

`<témoin>` est une machine du réseau local. Le script refuse, **avant de rien poser**, si la machine ne répond pas une adresse du tailnet, si elle n'a pas d'adresse `192.168.*`, ou si son `.env` n'a pas de ligne `MNEMO_OLLAMA_URL`. Il dit si les surcharges en place changent ou non (commentaires mis à part ; le `.env` n'est pas comparé) — à une repose, elles ne changent pas.

Il s'arrête à la première épreuve ratée. **L'épreuve qui compte** se fait depuis le témoin, sur le réseau local : les quatre ports de la machine doivent y être refusés — avec un **témoin**, le port 22 de la même adresse, qui doit répondre. Sans lui, « refusé » pourrait vouloir dire « injoignable ».

Puis, à la main : **une recherche depuis Claude Desktop**. Elle traverse toute la chaîne — MCP, API, Ollama, Qdrant — et aucun script ne la remplace.

`packages/homelab/src/mnemo.adversarial.test.ts` éprouve le script dans un Debian jetable, la machine, le témoin et le réseau simulés : le modèle rempli, chaque refus, les copies, le `.env` jamais affiché, et chaque épreuve ratée.

## Revenir en arrière

Sur la machine de Mnemo, `<date>` étant celle des copies **les plus anciennes** — celles de la première pose. Chaque repose fait de nouvelles copies, mais de fichiers déjà fermés : reprendre les plus récentes ne rouvrirait rien.

```bash
rm /etc/systemd/system/mnemo-{api,mcp}.service.d/ecoute-tailnet.conf
cp -p /etc/systemd/system/ollama.service.d/override.conf.bak-avant-<date> \
      /etc/systemd/system/ollama.service.d/override.conf
cp -p /root/projects/mnemo/.env.bak-avant-<date> /root/projects/mnemo/.env
systemctl daemon-reload
systemctl restart ollama mnemo-api mnemo-mcp mnemo-watch
```

## Au démarrage de la machine

Lié à l'adresse du tailnet, un service ne peut pas démarrer avant elle. La surcharge le place après `tailscaled`, et espace ses nouvelles tentatives de cinq secondes : au rythme par défaut de systemd, cinq échecs en dix secondes et l'unité serait abandonnée pour de bon — Mnemo resterait éteint en silence.

## Le nombre de threads d'Ollama

`LLAMA_ARG_THREADS=5` est **lié aux six cœurs du conteneur** : si leur nombre change, revoir cette valeur (le commentaire de `ollama-override.conf` dit pourquoi).

## Ce qui reste, hors de ce dépôt

- **Le défaut est dans le code de Mnemo** : ses adresses par défaut sont `0.0.0.0`. Une réinstallation rouvrirait le trou. À corriger dans son dépôt — `127.0.0.1` par défaut, le tailnet par configuration.
- **Un fichier nommé `/root/projects/mnemo/.env,`** (avec la virgule) — 16 octets, sans doute une copie faite par erreur, peut-être un secret. Non touché : à décider.
- **Une pose qui casse en route** (disque plein au milieu des `install`) s'arrête sans ligne « ECHEC » et laisse la machine à moitié posée — comme sous Legion. Les copies `*.bak-avant-<date>` permettent de revenir en arrière.
