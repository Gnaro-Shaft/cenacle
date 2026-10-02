# ADR-0008 — Un journal d'événements append-only, source des états affichés

**Statut** : acceptée (2026-10-02)

## Décision

- **Tout ce qui se passe est un événement** : relevé, appel de modèle, routage, proposition, acceptation, refus, annulation, envoi, erreur, purge. Le journal est **append-only** : des déclencheurs PostgreSQL interdisent `UPDATE` et `DELETE`.
- **L'état d'un agent se calcule** à partir de ses événements. Aucun agent ne garde d'état « dans sa tête », ce qui permet de reprendre après un redémarrage en relisant le journal.
- **Affichage : trois états visuels et une bulle.**

  | Visuel | États internes |
  |---|---|
  | 😌 au repos | `repos`, `attend le modèle local` (avec la mention « en attente du Mac ») |
  | ⚙️ en activité | `lit`, `réfléchit`, `rédige` |
  | 🤒 malade | `erreur` (un vrai problème uniquement) |
  | 💬 bulle avec compteur | validations en attente, quel que soit l'état |

- L'état détaillé est visible en survolant ou en cliquant le personnage, et dans Grafana.
- Les transitions sont poussées vers la page en **SSE**, et tracées en **OpenTelemetry** (→ Tempo → Grafana) **sans contenu de mail**.
- **Muet quand tout va bien** : un personnage au repos ne clignote pas. Seule une anomalie attire l'œil.
- **Pas de rattrapage** après une panne : on compte les tours manqués, on ne les rejoue pas. Un échec compte comme un passage.
