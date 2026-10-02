# Phase 3 — Suivre et alerter (boîte de test)

**Objectif** : Iris sait quels mails de clients et prospects attendent une réponse, me le rappelle après **48 heures ouvrées** (week-ends exclus, heure de Paris), et m'alerte selon ADR-0007 — sans jamais envoyer un mail elle-même.
**Critère de sortie** : aucune alerte manquée sur le jeu de test ; aucun contenu de mail dans Telegram.

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **S0 — Des fils dans le jeu de test** | Dossier Envoyés fictif (`fixtures/sent.json`), fils `Message-ID`/`In-Reply-To`/`References`, attendus calculés indépendamment ; piège « fil forgé » | `npm run fixtures:stats` |
| **S1 — La mémoire du courrier** | Lecture seule d'INBOX et d'Envoyés ; table `mail_items` en clés HMAC, 90 jours (ADR-0012) ; seuls les mails nouveaux sont relus et triés | « 147 mails mémorisés, 19 envoyés lus, 17 conversations » |
| **S2 — En attente de réponse** | Client/prospect sans réponse (même fil ou même adresse, après le mail) ; code pur | Compteurs « en attente » / « relance due » |
| **S3 — Relances** | Rappel **à moi** après 48 h ouvrées (jamais d'envoi) | « K relances dues » |
| **S4 — Alertes et récap** | Termes urgents, heures calmes, récap 9 h / 13 h / 18 h ; horloge injectable | Alerte simulée à 10 h et à 22 h |
| **S5 — Mesure** | 0 alerte manquée, 0 alerte en trop sur les pièges, 0 contenu dans Telegram | `npm run alert:bench` vert |

**Règle « répondu »** (validée le 02/10) : j'ai envoyé, après le mail, un mail dans le même fil ou à la même adresse. Un mail à un collègue du même domaine ne compte pas ; un mail envoyé avant non plus. Les domaines qui n'attendent pas de réponse par mail (notifications de plateforme) ne sont pas suivis.
