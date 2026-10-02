# ADR-0011 — Un dépôt public se pense dès le premier commit

**Statut** : acceptée (2026-10-02)

## Décision

- **Historique neuf** : aucun import de l'historique des projets précédents, qui contiennent des noms de machines et des chemins réels.
- **Rien de réel dans le dépôt** : configuration réelle hors dépôt (`.env`, `*.local.toml`), seuls des exemples sont versionnés. Aucun nom de tailnet, IP, adresse mail réelle ni chemin personnel.
- **Garde-fous automatiques** :
  - `gitleaks` en pré-commit et en CI ;
  - *secret scanning* et *push protection* GitHub ;
  - Dependabot ;
  - branche `main` protégée (CI verte obligatoire).
- **CI** : lint, typecheck, tests (adversariaux compris), `npm audit`, contrôle des licences des dépendances (compatibilité Apache-2.0). Dépendances minimales et épinglées ; toute extension communautaire relue avant usage.
- **Licence Apache-2.0** (`LICENSE` + `NOTICE`). README en anglais, ADR en français, `SECURITY.md`, `CONTRIBUTING.md` court.
- **Assets** : sprites originaux, ou sous licence compatible et crédités.
- **Commits** au format *Conventional Commits* ; un lot = une PR.

Publier l'architecture n'est pas un risque, puisque la sécurité ne repose pas sur le secret de la conception. Publier la topologie réseau de l'auteur en serait un.
