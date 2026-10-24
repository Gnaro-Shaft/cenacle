# Mesure — le contexte du CTO selon la question (ADR-0033)

**Date** : 2026-10-24. **Banc** : `npm run cto:banc-docs` (`apps/cli/src/cto-docs-bench.ts`), critères figés avant le changement dans `apps/cli/src/cto-docs-bench/questions.ts` (commit `8b39d48`).

## Ce qui est comparé

- **L'ancien contexte** : toute la documentation, dans l'ordre fixe de l'ADR-0017, budget 300 000 caractères. Aujourd'hui **290 654 caractères**, rien d'écarté.
- **Le nouveau** : le socle (8 documents) et la carte (50 documents), **38 900 caractères**, puis les documents choisis selon la question, entiers, jusqu'à 120 000 caractères. Il fait de 118 800 à 119 800 caractères selon la question.

15 questions dont la réponse est dans la documentation, dont 9 sur un ADR de 0002 à 0016. Les points attendus sont fixés à l'avance : 28 en tout. Le circuit est celui du service : `askCto`, avec les outils et la vérification des références. Modèle `qwen3.8:27b` sur Ollama, température 0,7. Iris tournait et partageait le modèle.

Les passages sont **groupés par contexte** : toutes les questions avec l'un, puis toutes avec l'autre. L'ancien prompt est le même pour toutes les questions, donc le serveur le garde en cache d'une question à l'autre. C'est son meilleur cas.

## Résultats

| Contexte | Passage | Points | Justes | Références introuvables | Appels d'outils | Temps médian |
|---|---|---|---|---|---|---|
| Ancien | 1 | 28 / 28 | 15 / 15 | 5 | 12 | 23 s |
| Ancien | 2 | 25 / 28 | 13 / 15 | 1 | 27 | 34 s |
| Nouveau (carte en fin, 1ʳᵉ version) | 1 | 28 / 28 | 15 / 15 | 1 | 12 | 96 s |
| Nouveau (carte en fin, 1ʳᵉ version) | 2 | 28 / 28 | 15 / 15 | 1 | 12 | 94 s |
| **Nouveau (livré)** | 1 | **28 / 28** | **15 / 15** | 3 | 6 | **82 s** |
| **Nouveau (livré)** | 2 | **28 / 28** | **15 / 15** | 1 | 0 | **82 s** |

La version livrée place la carte juste après le socle, comme l'ordonne l'ADR-0033 (§ 1). La première version la mettait à la fin. Ce début de prompt, identique pour toutes les questions, est réutilisé par le serveur : la médiane passe de 95 à 82 s. Les temps de la version livrée vont de 64 à 146 s.

### Lecture

- **Points** : le nouveau contexte couvre tous les points aux quatre passages. L'ancien en perd 3 au passage 2 :
  - Q01 : **échec par délai**. C'est la première question après le groupe « nouveau » : cache vide, lecture du prompt de 290 000 caractères, puis délai de 300 s dépassé ;
  - Q07 : **faux négatif du critère**. La réponse est juste, mais elle écrit « ferait tomber le verrou », que le motif `lâch|perd|perte` ne reconnaît pas. Le critère n'a pas été retouché.
- **Références introuvables** : aucune n'est une invention, dans un contexte comme dans l'autre. Ce sont :
  - des chemins que le CTO ne peut pas voir (`fixtures/mails.json`, `fixtures/`, interdits par l'ADR-0017) ;
  - des chemins coupés (`packages/...`, `docs/adr/0010`) ;
  - une adresse d'exemple écrite dans la documentation (`100.x.y.z:8790`).

  Le nouveau contexte n'en a pas davantage : 4 contre 6.
- **Critère de l'ADR-0033 (§ 6) : tenu.** Le nouveau contexte couvre au moins autant de points, sans référence introuvable de plus.

## Le temps : ce que l'ADR n'avait pas prévu

L'ADR-0033 annonçait une lecture « plus rapide », « à confirmer par le banc ». La mesure la nuance :

- **Ancien contexte, cache chaud** (la question précédente était aussi une question au CTO) : 23 à 34 s, plus rapide que le nouveau.
- **Ancien contexte, cache froid** (le modèle a servi Iris, la veille ou un autre agent entre-temps) : la lecture du prompt prend **4 min 50 s** sur Ollama. La question échoue au délai de 300 s dès qu'un appel d'outil suit. C'est arrivé deux fois sur deux à froid : l'essai de Q05 avant la mesure, et Q01 au passage 2.
- **Nouveau contexte** : environ 80 s à chaque question, chaud ou froid. Il n'a jamais échoué sur 60 réponses.

Le serveur ne garde qu'un prompt à la fois, et Iris, la veille, l'agent sécurité et le prospecteur l'interrogent aussi. En service, une question au CTO tombe donc souvent à froid. Le nouveau contexte échange un cas chaud rapide contre un temps prévisible et une question qui aboutit.

## Ce qui n'est pas mesuré

- Des questions **mal formulées** ou sans mot de la documentation : le score lexical y est plus faible. Le banc ne pose que des questions bien formées.
- La **passe de conformité** et la **relecture** : la relecture n'a pas changé, et la conformité n'a pas été rejouée.
- Le banc des 12 questions sur le code (`bascule-qwen36.md`) : ses réponses ne sont pas dans la documentation, il n'a pas été refait.
