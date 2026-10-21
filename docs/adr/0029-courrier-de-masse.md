# ADR-0029 — Le courrier de masse va en « Bruit », par ses en-têtes

**Statut** : acceptée (2026-10-21) — complète l'ADR-0007 ; garde l'ADR-0014 ; son point 2 est complété par l'ADR-0030 (domaines administratifs)

## Contexte

La mesure M2 du 2026-10-21 (`docs/mesures/m2.md`, 213 mails réels) a montré un classement à 52 % : le bruit n'est pas reconnu. Sur 157 mails que je range en « Bruit », Iris en met 48 en « Clients et prospects » et 37 en « Administratif ». Les règles par domaine font moins bien que le modèle (34 / 72) : un domaine administratif m'envoie à la fois ses factures et sa publicité, et une règle range tout en bloc. Les notifications de réseaux sociaux, que je range en « Bruit », ressemblent à des messages de personnes et trompent le modèle.

Iris ne lisait aucun des en-têtes que pose le courrier envoyé en nombre : `List-Unsubscribe` et `List-Id` (RFC 2369, 2919, 8058), `Precedence`.

## Décision

1. **Un mail est de masse** s'il porte un en-tête `List-Unsubscribe` ou `List-Id` non vide, ou un `Precedence` qui vaut `bulk`, `list` ou `junk`. C'est déterminé par le code, sans IA. `Auto-Submitted` n'en fait pas partie : il marque aussi des notifications utiles (banque, administrations).
2. **L'ordre du tri** :
   - un expéditeur illisible reste « À trier » ;
   - une règle « Clients et prospects » décide comme avant : client si l'expéditeur est authentifié, « À trier » sinon (ADR-0014). Le courrier de masse n'y touche pas : un client qui m'écrit depuis un outil d'envoi reste un client ;
   - sinon, **un mail de masse va en « Bruit »**, avant une règle « Administratif » ou « Bruit » et avant le modèle. Il sépare ainsi la publicité d'un domaine administratif de ses factures ;
   - sinon, comme avant : la règle du domaine, puis le modèle.
3. **N'importe qui peut écrire ces en-têtes** (même raisonnement que l'ADR-0014). Ils ne peuvent que faire *descendre* un mail en « Bruit », jamais le faire monter vers « Clients et prospects » ni lui éviter « À trier » quand une règle client le refuse. Un expéditeur qui les pose pour se cacher ne cache que lui-même. Un en-tête présent deux fois compte : un doublon ne l'efface pas.
4. **Minimisation** : ces en-têtes sont lus avec les autres (même requête IMAP, `BODY.PEEK`), réduits à un booléen en mémoire le temps du tri, et jamais gardés. Seule la cause est gardée : `decided_by = 'masse'`, visible comme l'auteur `regle:<domaine>` de l'ADR-0007.
5. **Ce qui est déjà rangé ne bouge pas** : la règle vaut pour les mails reçus après elle.

## Conséquences

- La mesure compte ces décisions à part (« par courrier de masse »). Le jeu de test reçoit du courrier de masse fictif, qu'il sous-représentait (88 % au banc contre 52 % en vrai).
- Un service qui pose `List-Unsubscribe` jusque dans ses factures les enverra en « Bruit ». La mesure le dira ; une liste d'exceptions par domaine viendrait alors dans un ADR à part.
- Une nouvelle valeur de `decided_by` : la contrainte de la base est refaite (migration 025).

## Options écartées

- **Laisser le modèle décider avec ces en-têtes dans son prompt** : il se trompe déjà avec assurance (5 % laissés « À trier ») ; une règle est vérifiable et testée.
- **Une règle « Bruit » par domaine pour chaque plateforme** : elle range aussi les vrais messages d'un domaine mixte, et il faut la tenir à jour à la main. Elle reste possible dans `regles.local.toml`, et l'en-tête l'emporte.
- **Compter `Auto-Submitted: auto-generated`** : écarté pour l'instant (point 1).
