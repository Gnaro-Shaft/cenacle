# La sentinelle (phase 5, S2 — ADR-0002)

Un petit programme sur un VPS, en Europe : il entend les battements d'Iris, de l'exécuteur et de l'agent sécurité, et me prévient sur Telegram quand ils cessent (une alerte par panne) puis quand ils reprennent. **Il ne voit aucun contenu**, et **ne parle jamais au Mac** : c'est le Mac qui lui parle.

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
- `SENTINEL_TELEGRAM_TOKEN` et `SENTINEL_CHAT_ID` : le bot de la sentinelle et mon identifiant de conversation ;
- `SENTINEL_PROGRAMS` : les programmes qui doivent tourner, séparés par des virgules (`iris,executor,securite` par défaut). Tant que la vraie boîte n'est pas ouverte aux envois (M2), l'exécuteur ne tourne pas : `SENTINEL_PROGRAMS=iris,securite`, sinon son silence est pris pour une panne. À remettre à `iris,executor,securite` à l'ouverture de `[ouverture] envoi` (M3).
- L'agent sécurité (J6e1) bat une fois par ronde **allée à son terme**, toutes les 15 minutes : son silence ne compte qu'au-delà de 35 minutes (deux rondes manquées), quel que soit `SENTINEL_SILENCE_MINUTES` s'il est plus court. Une ronde qui échoue à chaque passage se tait, et finit donc par être signalée.
- Un programme muet alors qu'un autre a battu dans les `SENTINEL_SILENCE_MINUTES` est dit **arrêté** (le Mac tourne) ; tous muets, c'est **le Mac** qui est peut-être en panne.

Puis `systemctl enable --now cenacle-sentinel`. Le service tourne sous un utilisateur jetable, sans droit d'écriture.

## Sur le Mac

- Dans `.env` : `CENACLE_SENTINEL_URL=http://<nom-tailscale-du-vps>:8790/battement`
- Dans `.env.sentinel` (600) : `CENACLE_SENTINEL_TOKEN=<le jeton partagé>`
- Relancer Iris et l'exécuteur ; l'agent sécurité prend la configuration à sa ronde suivante. Sans URL, ils le disent et n'envoient rien.
- **Ordre de mise à jour** : poser d'abord la nouvelle sentinelle (`install.sh`), puis ajouter `securite` à `SENTINEL_PROGRAMS`. Une ancienne sentinelle refuse le battement de l'agent sécurité : la ronde le dit (« la sentinelle n'a pas pris le battement ») et continue.

## Le sens des flux, imposé par Tailscale

Le VPS ne doit joindre **aucune** machine de chez moi. Dans la console Tailscale (Access controls), étiqueter le VPS `tag:sentinelle`, et n'autoriser vers lui que le Mac, sur le seul port 8790. Aucune règle ne part de `tag:sentinelle`. Exemple de règle à **ajouter** aux règles existantes (à adapter : les autres machines, Legion et Myriade, ont leurs propres règles) :

```json
{ "action": "accept", "src": ["<le Mac>"], "dst": ["tag:sentinelle:8790"] }
```

Avant d'appliquer, vérifier qu'aucune règle large (`"src": ["*"]`, `"dst": ["*:*"]`) ne laisse le VPS joindre le reste du réseau.

La règle par défaut d'une nouvelle politique Tailscale (`"src": ["*"], "dst": ["*"], "ip": ["*"]`) **laisse le VPS joindre toutes les machines** (constaté le 2026-10-05 : le port SSH du Mac répondait). La corriger en remplaçant `"*"` par `"autogroup:member"` dans `src` seulement : une machine étiquetée n'est plus membre, elle ne peut plus ouvrir de connexion, et les machines des utilisateurs gardent leurs accès. Contrôle, depuis le VPS : `nc -z -w 4 <adresse Tailscale du Mac> 22` doit échouer.

## Vérifier

- Couper Iris : au bout de 10 minutes, une alerte arrive ; la relancer : un message de retour.
- `journalctl -u cenacle-sentinel` : ni contenu, ni adresse ; seulement l'écoute et les échecs Telegram.
