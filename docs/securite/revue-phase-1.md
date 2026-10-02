# Revue de sécurité — fin de la phase 1 (2026-10-02)

Périmètre : le socle (journal, état des agents, page, Telegram, routeur et modèle local, observabilité). Aucune donnée réelle n'est encore traitée.

## Vérifié

| Point | Méthode | Résultat |
|---|---|---|
| Secrets dans l'historique Git | `gitleaks` v8.30.1 sur tout l'historique d'un clone du dépôt public + recherche de motifs (IP Tailscale, nom de tailnet, chemins personnels, jetons Telegram) | Aucune fuite. Seul « jeton » : le faux jeton des tests |
| Vulnérabilités des dépendances | `npm audit` | 0 |
| Licences des dépendances | `license-checker`, liste blanche | Toutes compatibles avec Apache-2.0 (MIT, Apache-2.0, BSD, ISC, 0BSD, Unlicense ; MPL-2.0 pour `lightningcss`, outil de build non distribué) |
| Ports ouverts sur le poste | `lsof -iTCP -sTCP:LISTEN` | API 8787, page 5173, PostgreSQL 55432 : **127.0.0.1 uniquement**. Tempo 4318 et Grafana 3000 : 127.0.0.1 dans `compose.yaml` |
| Sortie réseau du modèle | Test : seules requêtes vers l'adresse locale configurée | OK |
| Contenu dans les traces | Test sur les octets OTLP réellement envoyés | Aucun texte de question ni de réponse |
| Réécriture du journal | Déclencheurs PostgreSQL + rôle applicatif sans `UPDATE`/`DELETE` | Refusée, même pour l'administrateur |

## Constats et suites

| # | Constat | Gravité | Suite |
|---|---|---|---|
| 1 | Droits du `.env` trop larges (`-rw-r--r--`) | Moyenne | `chmod 600 .env` |
| 2 | Adresse mail personnelle comme auteur des commits publiés | Faible (déjà publique) | Adresse *noreply* GitHub pour la suite ; historique laissé tel quel (décision du propriétaire) |
| 3 | Le serveur de modèles écoute sur l'adresse Tailscale : tout appareil du tailnet peut l'utiliser | Faible tant que le tailnet est personnel | ACL Tailscale limitant le port du modèle aux appareils de Cénacle |
| 4 | Branche `main` non protégée | Moyenne | Règle GitHub : CI verte obligatoire avant fusion |
| 5 | Actions GitHub désignées par version, pas par empreinte | Faible | À épingler par SHA |
| 6 | Pas de limite de débit sur les tentatives Telegram rejetées | Faible | Plafonner la journalisation des `telegram.rejected` |
| 7 | L'API locale n'a pas d'authentification | Sans objet tant qu'elle reste sur 127.0.0.1 | Obligatoire (identité Tailscale) avant toute exposition, phase 4 |
