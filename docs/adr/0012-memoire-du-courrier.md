# ADR-0012 — Ce qu'Iris retient d'un mail : des clés, pas des adresses, 90 jours

**Statut** : acceptée (2026-10-02)

## Contexte

Pour suivre les réponses (phase 3), Iris doit se souvenir des mails d'une relève à l'autre : sa case, sa date, qui l'a envoyé et à quelle conversation il appartient. Sans mémoire, elle referait tout trier par le modèle à chaque passage et ne saurait pas qu'une réponse a été envoyée.

## Décision

- **Une table `mail_items`** (`packages/journal/sql/002_mail_items.sql`) : par mail, la boîte (réception ou envoyés), l'UID, la date d'arrivée, la case et qui l'a décidée (règle, expéditeur illisible, modèle).
- **Pseudonymisation (RGPD art. 4(5))** : l'expéditeur, les destinataires et les identifiants de conversation (`Message-ID`, `In-Reply-To`, `References`) sont stockés **uniquement sous forme de clés HMAC-SHA256**, calculées avec un secret `CENACLE_MAIL_KEY` qui ne vit que dans `.env`. Sans le secret, une clé ne permet pas de retrouver une adresse, même en essayant toutes les adresses connues (ce qu'un simple hachage permettrait).
- **Rien d'autre** : ni objet, ni corps, ni nom, ni adresse, ni domaine en clair. Le domaine sert au rangement au moment de la relève, puis il est oublié.
- **La base refuse ce que le code ne doit jamais écrire** : une clé qui n'a pas la forme d'une clé (64 caractères hexadécimaux), une case inconnue, une case sans décideur, une case sur un mail envoyé. Le rôle applicatif peut lire, ajouter, ranger et supprimer, mais pas modifier la structure de la table.
- **Conservation : 90 jours** après l'arrivée du mail (validé le 02/10/2026), puis suppression à chaque relève. Si le serveur renumérote une boîte (UIDVALIDITY), sa mémoire est effacée et relue.
- **Conversations** : reconstituées à partir des clés seules ; deux mails au même objet ne sont pas la même conversation si leurs en-têtes ne le disent pas.

## Conséquences

- Une deuxième relève ne lit que les mails nouveaux et ne renvoie au modèle que ceux qui ne sont pas encore rangés.
- **Perdre `CENACLE_MAIL_KEY`** rend les clés inutilisables : il faut alors vider la table et tout relire. Le secret doit être sauvegardé avec les autres secrets (phase 5).
- À inscrire au registre des traitements et à l'AIPD avant la bascule sur une vraie boîte (phase 5) : finalité (suivi des réponses), données (clés, dates, cases), durée (90 jours).
