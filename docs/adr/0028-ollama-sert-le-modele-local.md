# ADR-0028 — Ollama sert le modèle local

**Statut** : acceptée (2026-10-21) — précise l'ADR-0002 et l'ADR-0018 ; l'ADR-0003 ne change pas

## Contexte

Depuis J7, LM Studio sert `qwen/qwen3.8-27b` (MLX 4 bits) sur le Mac. Mes autres applications passent par Ollama : deux serveurs à tenir, et le même modèle chargé deux fois (environ 18 Go chacun).

L'évaluation du 2026-10-20 (`docs/mesures/bascule-qwen36.md`, données fictives seulement) a écarté `qwen3.6:35b` et mesuré `qwen3.8:27b` servi par Ollama : le CTO appelle ses outils, le tri tient le critère M5 (88 %), la veille est au moins aussi bonne, aucun piège de sécurité n'est obéi, et tout va 1,6 à 2 fois plus vite. Deux écarts restaient : le CTO répond juste moins souvent (6 à 8 questions sur 11, contre 9 à 10), et une veille sur trois a laissé fuir son raisonnement avant `</think>`.

## Décision

1. **Ollama sert le modèle local**, sur le Mac, à l'écoute de `127.0.0.1` seulement : `LOCAL_MODEL_BASE_URL=http://localhost:11434/v1`, `LOCAL_MODEL_ID=qwen3.8:27b` (NVFP4). Le modèle n'est plus joint par le nom Tailscale du Mac : rien du modèle n'est exposé sur le réseau privé.
2. **L'ADR-0003 tient tel quel** : un seul modèle, local ; s'il ne répond pas, on attend. Ollama sait relayer un modèle vers son propre service en ligne : deux filets l'interdisent. Côté serveur, `OLLAMA_NO_CLOUD=1`. Côté code, `localModelConfigFromEnv` refuse un modèle dont le nom porte `cloud` (`…:cloud`, `…-cloud`) et l'adresse `ollama.com` : le programme ne démarre pas.
3. **Les réglages du serveur** vivent dans un agent `launchd` de mon compte, hors du dépôt, et tiennent après un redémarrage : contexte de 262 144 tokens (`OLLAMA_CONTEXT_LENGTH`, au-dessus des 131 072 du CTO), modèle gardé chargé (`OLLAMA_KEEP_ALIVE=-1`), un seul modèle à la fois (`OLLAMA_MAX_LOADED_MODELS=1`), pas de cloud. Le Modelfile de `qwen3.8:27b` fixe `num_predict 32768` ; l'original reste sous `qwen3.8:27b-origine`.
4. **Le code ne dépend pas du serveur** (même API compatible OpenAI, `reasoning_effort: "none"` respecté). Deux ajustements, valables pour tout serveur :
   - ce qui précède le dernier `</think>` d'une réponse est ignoré (`packages/brain/src/answer-text.ts`) ; rien après lui est une réponse vide, donc un échec visible ;
   - le CTO envoie sa température, 0,7 (`CTO_TEMPERATURE`), au lieu du 1 du Modelfile : c'est la meilleure valeur mesurée. Iris garde 0 pour ses tâches courtes ; la veille et la sécurité suivent le serveur (non mesuré).
5. **Un seul modèle pour tout le Mac** : mes autres applications passent aussi sur `qwen3.8:27b` (décidé le 2026-10-21). Avec un seul modèle chargé, aucun appel ne décharge l'autre.
6. **Le retour arrière** : LM Studio reste installé jusqu'au 2026-10-28, modèle déchargé et démarrage automatique coupé. Revenir, c'est remettre deux lignes de `.env` et relancer les services.

## Conséquences

- Une seule copie du modèle en mémoire : environ 18 Go rendus au Mac.
- Le CTO peut répondre juste un peu moins souvent qu'avec LM Studio. `npm run cto:bench` sur Ollama, le 2026-10-21 : 2 / 6 à la lecture honnête, contre 0 / 6 sur LM Studio la veille (`docs/mesures/bascule-qwen36.md`) ; l'écart se suit sur mes vraies questions.
- Les journaux d'Ollama (`~/.ollama/logs`, niveau `INFO`) n'écrivent pas le texte des prompts (vérifié le 2026-10-20).
- Les versions d'Ollama sont déjà suivies par la veille (`veille.toml`). Une mise à jour peut changer le gabarit du modèle : on repasse alors `npm run probe:thinking` et `npm run mail:bench`.
- Le registre IA, le registre des traitements, le README et `deploy/launchd/README.md` nomment Ollama.

## Options écartées

- **Garder LM Studio** : deux serveurs, le modèle chargé deux fois, et le CTO un peu meilleur. L'écart mesuré ne justifiait pas de tenir deux serveurs.
- **`qwen3.6:35b`** : le CTO n'appelle pas ses outils (1 et 2 sur 11), le tri passe sous M5 (72 %).
- **Faire chercher le code avant que le modèle réponde** : piste vue ailleurs, non mesurée ici ; elle changerait le circuit du CTO et demanderait son propre ADR.
- **Ollama à l'écoute du réseau privé** : rien hors du Mac n'interroge le modèle.
