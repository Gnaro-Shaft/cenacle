# ADR-0016 — Iris lit tous les dossiers de la boîte, et suit un mail déplacé

**Statut** : acceptée (2026-10-06) — complète l'ADR-0012

## Contexte

Iris ne lisait que la boîte de réception, et oubliait un mail dès qu'il en sortait (« supprimé ou déplacé »). Or je range mes mails dans des dossiers par réflexe, dès leur arrivée : les 5 et 6 octobre, les 3 mails rangés par Iris ont été oubliés à la relève suivante, et 26 mails reçus depuis le 4 octobre étaient déjà dans 10 dossiers. Iris ne voyait presque rien de mon courrier : ni suivi, ni alerte, ni mesure possible.

Toute la mémoire reposait sur une hypothèse : un mail, c'est un UID dans la boîte de réception. Quand je déplace un mail, le serveur lui donne un nouvel UID dans le nouveau dossier.

## Décision

1. **Les dossiers lus** (décidé le 06/10, option « tous ») : tous les dossiers de la boîte, réception comprise, **sauf** ceux que le serveur étiquette Envoyés, Corbeille, Indésirables ou Brouillons (étiquettes RFC 6154, jamais devinées d'après un nom), les dossiers virtuels (« Tous les messages », « Suivis »), les dossiers qui ne contiennent pas de mails, et le dossier des envoyés du cadre. Plus de 200 dossiers : refus, plutôt que de choisir.
2. **Un identifiant à Iris pour chaque mail reçu**, qui ne change pas quand je le déplace. Où il se trouve (dossier, UIDVALIDITY, UID) est rangé à part (`mail_locations`), et change avec lui. Le reste — suivi, alertes, propositions, signature d'acceptation — continue de parler d'une seule « réception » virtuelle (UIDVALIDITY `0`).
3. **Un mail déplacé est reconnu** à son Message-ID, **à condition** que son expéditeur et sa date d'arrivée soient les mêmes. Il garde alors sa case, le verdict d'authentification, son suivi et son alerte ; il n'est pas reclassé, le modèle ne le relit pas. Un Message-ID seul ne suffit jamais : un mail forgé qui reprendrait celui d'un client ne prend pas sa place. Une copie d'un mail encore en place n'est retenue qu'une fois.
4. **Un curseur par dossier** : chaque dossier est relu à partir de là où la passe précédente s'est arrêtée, au-delà de tout mail regardé, retenu ou non. Un dossier plein de mails antérieurs à la mention n'est lu qu'une fois. Les curseurs ne sont enregistrés qu'une fois les mails enregistrés : une passe interrompue relit les mêmes mails.
5. **Les noms de dossiers ne sont jamais stockés** : seulement leur clé HMAC, comme les adresses (un nom de dossier peut nommer un client). Ni nom ni clé de dossier dans le journal, Telegram ou les traces.
6. **Effacer un mail retenu efface son emplacement**, dans la même transaction (déclencheur), quelle que soit la cause : conservation, effacement d'une personne, mail parti du serveur. Un mail déplacé dans un dossier qu'Iris ne lit pas (la Corbeille) est oublié, comme un mail supprimé.
7. **Relire un mail** (tri par le modèle, brouillons, page, exécuteur, mesures) passe par son emplacement actuel.
8. Les mails retenus avant cette décision, sous la numérotation du serveur, sont oubliés une fois et relus sous les identifiants d'Iris.

## Conséquences

- Mon réflexe de rangement ne gêne plus Iris : un mail rangé reste suivi.
- Toutes les règles de lecture valent pour chaque dossier : lecture seule (EXAMINE, nombre de non-lus vérifié), rien d'antérieur à la mention, liste d'opposition, plancher de l'article 9.
- Une passe ouvre une connexion par dossier lu : une vingtaine toutes les 15 minutes sur ma boîte.
- Un mail déplacé entre deux passes vers un dossier qu'Iris ne lit pas, puis remis, revient comme un nouveau mail.
- Un mail dont le serveur ne conserve pas la date d'arrivée lors d'un déplacement serait vu comme nouveau (et l'ancien oublié) : son suivi repartirait de zéro. Les serveurs IMAP la conservent.

## Options écartées

- **Une liste explicite de dossiers** dans le cadre : plus prudente (un dossier personnel n'est lu que si je l'ajoute), écartée le 06/10 au profit de la lecture de tous les dossiers ; le plancher de l'article 9 s'applique à chacun.
- **Garder en mémoire un mail sorti de la réception sans le suivre** : il ne serait plus relisible, ni par la mesure ni par la page.
- **Une colonne « dossier » dans `mail_items`** : la numérotation du serveur aurait gardé un rôle partout (propositions, suivi, signature) ; l'identifiant propre à Iris l'isole en un seul endroit.
