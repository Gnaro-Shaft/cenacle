# ADR-0020 — Le CTO devient un service local, que la page interroge

**Statut** : acceptée (2026-10-09) — complète l'ADR-0017

## Contexte

En J1, le CTO ne répond qu'en ligne de commande (`npm run cto`). Le jalon J2 veut que je puisse lui parler depuis la page et depuis Telegram (`docs/phase-6.md`).

Il ne peut vivre ni dans le serveur de la page ni dans le bot : l'ADR-0017 (§ 5) veut qu'il ne détienne **aucun secret**, or le serveur détient le mot de passe de la boîte et la clé de signature de la page, et le bot détient le jeton Telegram. Et le modèle est partagé avec Iris : deux CTO qui le sollicitent en même temps se gênent.

## Décision

1. **Un programme à part** (`apps/cto`), lancé par `launchd` comme les autres (ADR-0018, ADR-0019) : il refuse de démarrer s'il détient un secret, et un verrou n'en laisse tourner qu'un.
2. **Une prise locale** (socket Unix `~/Library/Application Support/cenacle/cto.sock`), droits 0600 dans un dossier 0700 : seul mon compte peut lui parler. Aucun port réseau, donc aucun jeton à gérer. Une ligne JSON par message, vérifiée des deux côtés : une question (`{"question": …}`, rien d'autre), puis des lignes d'avancement (compteurs), puis une réponse ou une erreur codée.
3. **Une question à la fois** sur le modèle partagé ; au plus trois en attente, au-delà « occupé ». Une question dont l'auteur est parti en attendant n'est pas posée au modèle.
4. **Rien n'est gardé** (ADR-0017 § 6, inchangé) : la question et la réponse vivent en mémoire le temps de la réponse ; le journal reçoit des compteurs. Une erreur du modèle sort comme un code et un mot générique, jamais le message du serveur de modèles.
5. **La page** : une route `POST /api/cto`, protégée comme les autres actions (jeton de la page, origine, JSON), transmet la question au service et rend la réponse vérifiée avec son bilan. La page l'affiche **en texte brut** : rien de ce qu'écrit le modèle n'est interprété comme du HTML.
6. **`npm run cto`** passe par le service quand il tourne, et répond seul sinon, avec le même circuit (documentation, modèle local, vérification).
7. **Telegram** (option (a) du 09/10, jalon J2b) : `/cto` y transmet mes questions, avec une règle écrite — **aucune donnée de tiers dans une question** (ni nom de client, ni contenu de mail), rappelée par `/aide` et par chaque accusé de réception. Le bot relaie sans bloquer `/etat` ni `/stop`, découpe la réponse en messages de 4 000 caractères au plus, en texte brut, et ne garde rien. Le registre des traitements (ligne Telegram) et l'ADR-0006 sont complétés.

## Conséquences

- Je peux interroger le CTO depuis la page, sans terminal.
- Les questions passent l'une après l'autre : à trois questions d'avance, la mienne peut attendre plusieurs minutes.
- La page affiche le texte brut, sans mise en forme : plus sûr, moins joli.

## Options écartées

- **Le CTO dans le serveur de la page ou dans le bot** : il partagerait leur processus et leurs secrets (ADR-0017 § 5).
- **Un port HTTP local avec un jeton** : un jeton de plus à garder ; la prise, protégée par les droits du système, n'en demande aucun.
- **Une file d'attente en base** : la question serait écrite en base, contre l'ADR-0017 (§ 6).
