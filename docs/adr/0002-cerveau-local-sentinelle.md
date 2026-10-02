# ADR-0002 — Le cerveau vit sur le Mac, un petit VPS sert de sentinelle sans contenu

**Statut** : acceptée (2026-10-02)

## Contexte

Les modèles tournent sur un Mac à mémoire unifiée, la seule machine équipée d'un GPU. À terme, un Mac Studio dédié est envisagé comme machine définitive. Un VPS qui hébergerait tout Cénacle aurait dû être sécurisé, puis démonté au moment de la migration, et il aurait gardé du contenu de mails hors de chez soi.

## Décision

- **Le cerveau est sur le Mac** : agents, modèles, base de données, mémoire, tout contenu de mail. Docker Compose pour les services ; les modèles en **natif** (LM Studio / MLX), puisque Docker n'accède pas au GPU sur macOS.
- **La sentinelle est un petit VPS** (Europe, France de préférence), qui **ne voit aucun contenu** :
  - il envoie le récapitulatif et répond sur Telegram même si le Mac est injoignable ;
  - il relaie les notifications Web Push ;
  - il **surveille le Mac de l'extérieur** : le Mac lui envoie un battement de cœur, et son absence déclenche une alerte.
- **Le sens des flux est imposé** : c'est le Mac qui parle au VPS, jamais l'inverse. L'ACL Tailscale interdit au VPS de joindre une machine du réseau local.
- **Calendrier** : tout tourne sur le Mac pendant la construction (boîtes de test). La sentinelle arrive avant le branchement d'une vraie boîte. La migration vers la machine définitive se fait avec le même Compose.

## Conséquences

- Une coupure de courant ou d'accès internet arrête le cerveau. La sentinelle le signale ; un onduleur et un accès 4G de secours en réduisent la probabilité.
- Un VPS compromis ne voit ni mail ni base, et ne peut pas remonter vers le réseau local.
- Le Mac doit tenir comme un serveur : mises à jour, sauvegardes chiffrées hors machine, restauration éprouvée.

## Alternatives écartées

- **Tout sur un VPS** : contenu des mails hors de chez soi, pas de GPU, travail de sécurisation à refaire au moment de la migration.
- **Tout sur le Mac sans sentinelle** : personne ne constate une panne. Un dispositif de surveillance ne peut pas observer sa propre absence.
