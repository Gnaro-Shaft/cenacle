# Phase 5 — La vraie boîte

**Objectif** : Iris travaille sur ma vraie boîte professionnelle. Elle trie, suit et propose des réponses, que je valide une à une.
**Critère de sortie** : sur ma vraie boîte, les mesures de la phase 4 tiennent : aucun envoi sans mon acceptation, aucun fait inventé, aucune fuite. Chaque donnée réelle est couverte par un traitement déclaré, informé et purgé.

**Ordre juridique avant ordre technique** (ADR-0009). Aucun mail réel n'est lu avant que les jalons C0 à C4 soient faits.

Un jalon = une branche + une pull request, CI verte obligatoire.

| Jalon | Contenu | Démonstration |
|---|---|---|
| **C0 — Registres** | Registre des traitements, registre IA, examen et AIPD légère, procédure en cas de violation (`docs/conformite/`) | Documents relus et validés par le responsable |
| **C1 — Le cadre exécutable** | Traitements déclarés dans `cadre.toml` (ADR-0009) : une boîte réelle sans traitement ouvert n'est pas lue, une mention sans date fait échouer le démarrage ; durées dans `[conservation]` (mémoire 90 j, texte des brouillons 7 j, propositions closes 90 j, journal 180 j), purge quotidienne par Iris, par des fonctions en base qui laissent une trace | Démarrage refusé sans traitement ; purges éprouvées en base |
| **C2 — Plancher article 9** | Liste fermée et déterministe, sans IA ; un mail écarté n'est jamais lu par le modèle (deux lignes : avant l'appel, et dans le modèle lui-même) ; marque unique « écarté » qui ne dit pas pourquoi ; l'alerte urgente est gardée | `npm run floor:bench` : 18/18 sensibles écartés, 2/147 ordinaires écartés à tort |
| **C3 — Droits des personnes** | `npm run personne` : exporter, effacer, retirer de la liste d'opposition ; l'effacement tient grâce à la liste d'opposition (clé HMAC seule), et ne touche personne d'autre | Export, effacement vérifié en base ; une relève ne réapprend rien (les sauvegardes suivront en S1) |
| **C4 — Mention révisée** | Un paragraphe « Mon assistant de messagerie » ajouté aux mentions du site (`docs/conformite/mention-information.md`) : lecture du contenu par un modèle local, clé dérivée de l'adresse, brouillons, envois acceptés, plancher article 9, durées, droits ; les paragraphes existants (Legion, Myriade) restent justes pour leurs outils | **Publiée le 4 octobre 2026, vérifiée en ligne** ; sa date (`2026-10-04`) inscrite dans `cadre.toml` à l'ouverture |
| **S1 — Secrets et séparation** | Un fichier par famille de secrets (`.env.owner`, `.env.mail`, `.env.telegram`, `.env.obs`, avec `.env.page` et `.env.executor`), chargé par les seuls programmes qui en ont besoin ; `secrets:split`, `secrets:backup`, `secrets:restore` ; la base n'est pas sauvegardée | Chaque programme refuse les secrets des autres ; sauvegarde chiffrée restaurée |
| **S2 — Sentinelle** (ADR-0002) | `apps/sentinel` sur un petit VPS : battements d'Iris et de l'exécuteur (programme et heure, rien d'autre), une alerte Telegram par panne et un message de retour, par un bot à lui ; le Mac parle, la sentinelle écoute ; service systemd durci, ACL Tailscale (`deploy/sentinel/`) | Une panne du Mac est signalée |
| **M1 — Vraie boîte de test** (ADR-0010) | Une adresse de test de mon domaine : TLS obligatoire, certificat vérifié, envoi limité à mes propres adresses | Phase 4 rejouée sur un vrai serveur |
| **M2 — Vraie boîte, lecture seule** | Tri et suivi sur la vraie boîte, sans brouillon ni envoi | Mesures publiées (classement, « À trier », fuites) |
| **M3 — Brouillons et envois réels** | Brouillons et envois sur la vraie boîte | Critère de sortie de la phase |

## Décisions (04/10)

- **La boîte** : ma boîte professionnelle, hébergée chez OVH en France ; aucun transfert hors UE, et OVH en était déjà le sous-traitant. Les adresses et l'hôte réels restent hors du dépôt (`.env`, `*.local.toml`).
- **Legion** lit déjà cette boîte (domaines seulement, aucun modèle). **Cénacle le remplacera à terme**, quand tout fonctionnera. D'ici là les deux coexistent, chacun avec son traitement et sa mention.
- **AIPD** : légère, sur le modèle de celle de Myriade.
- **Aide de l'IA** : elle est signalée dans les mentions du site ; à vérifier en C4, et à étendre à Cénacle.
- **Ordre** : registres et cadre d'abord, puis la sentinelle avant toute vraie boîte (ADR-0002), puis une vraie boîte de test sur mon domaine (ADR-0010).
