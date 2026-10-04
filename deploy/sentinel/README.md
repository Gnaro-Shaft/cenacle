# La sentinelle (phase 5, S2 — ADR-0002)

Un petit programme sur un VPS, en Europe : il entend les battements d'Iris et de l'exécuteur, et me prévient sur Telegram quand ils cessent (une alerte par panne) puis quand ils reprennent. **Il ne voit aucun contenu**, et **ne parle jamais au Mac** : c'est le Mac qui lui parle.

## Ce qu'il faut, une fois

1. **Un bot Telegram à lui**, créé auprès de BotFather. Le jeton du bot principal ne quitte jamais le Mac : un VPS compromis ne peut pas se faire passer pour Iris.
2. **Un jeton partagé** entre le Mac et la sentinelle, tiré une fois : `openssl rand -hex 32`.
3. **Node 24 ou plus** et **Tailscale** sur le VPS.

## Sur le VPS

Copier `apps/sentinel` et `deploy/sentinel` (en gardant l'arborescence), puis, en root :

```
deploy/sentinel/install.sh
```

Remplir `/etc/cenacle-sentinel.env` (lisible par root seul) :
- `SENTINEL_LISTEN` : l'adresse **Tailscale** du VPS et le port (`100.x.y.z:8790`) — jamais `0.0.0.0` : le programme le refuse ;
- `SENTINEL_TOKEN` : le jeton partagé ;
- `SENTINEL_TELEGRAM_TOKEN` et `SENTINEL_CHAT_ID` : le bot de la sentinelle et mon identifiant de conversation.

Puis `systemctl enable --now cenacle-sentinel`. Le service tourne sous un utilisateur jetable, sans droit d'écriture.

## Sur le Mac

- Dans `.env` : `CENACLE_SENTINEL_URL=http://<nom-tailscale-du-vps>:8790/battement`
- Dans `.env.sentinel` (600) : `CENACLE_SENTINEL_TOKEN=<le jeton partagé>`
- Relancer Iris et l'exécuteur. Sans URL, ils le disent au démarrage et n'envoient rien.

## Le sens des flux, imposé par Tailscale

Le VPS ne doit joindre **aucune** machine de chez moi. Dans la console Tailscale (Access controls), étiqueter le VPS `tag:sentinelle`, et n'autoriser vers lui que le Mac, sur le seul port 8790. Aucune règle ne part de `tag:sentinelle`. Exemple de règle à **ajouter** aux règles existantes (à adapter : les autres machines, Legion et Myriade, ont leurs propres règles) :

```json
{ "action": "accept", "src": ["<le Mac>"], "dst": ["tag:sentinelle:8790"] }
```

Avant d'appliquer, vérifier qu'aucune règle large (`"src": ["*"]`, `"dst": ["*:*"]`) ne laisse le VPS joindre le reste du réseau.

## Vérifier

- Couper Iris : au bout de 10 minutes, une alerte arrive ; la relancer : un message de retour.
- `journalctl -u cenacle-sentinel` : ni contenu, ni adresse ; seulement l'écoute et les échecs Telegram.
