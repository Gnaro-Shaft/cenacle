# ADR-0032 — L'agent prospection : la veille des missions, un tableau, aucun droit d'agir

**Statut** : acceptée (2026-10-22) — s'appuie sur l'ADR-0031 (la case « Missions ») ; suit le modèle de la veille du CTO (ADR-0024) et de l'agent sécurité (ADR-0025)

## Contexte

Je cherche des missions freelance. Aujourd'hui, je lis à la main les alertes des plateformes, je recopie ce qui m'intéresse et j'oublie de relancer. Je veux un agent qui fasse la veille seul et suive ma prospection, sur le modèle d'un tableau en quatre colonnes : **Détectées → Client direct (sans ESN) → Mon profil (stack, TJM) → Alerte**.

Ce qui a été fixé avant cet ADR (2026-10-22) :

- **un agent de Cénacle**, en TypeScript, et non une application à part : elle aurait ouvert ma boîte une seconde fois, avec sa propre sécurité et son propre registre ;
- **le modèle local seulement**, servi par Ollama (ADR-0003, ADR-0028) ;
- **les alertes e-mail des plateformes**, rangées par Iris dans « Missions » (ADR-0031), **et ce que je repère moi-même**, ajouté à la main. Aucune collecte automatique sur le réseau professionnel (ses conditions l'interdisent, et ses posts contiennent des données de personnes) ;
- **l'agent n'a aucun droit d'agir** (charte, règle 1) : il ne postule pas, n'écrit à personne, n'ouvre aucun lien.

## Décision

### Le programme

1. **Un programme à part, `apps/prospection`** (logique dans `packages/prospection`), lancé par launchd **toutes les 15 minutes, aux heures où Iris relève** (8 h à 20 h, du lundi au vendredi), une seule instance à la fois (verrou, ADR-0018). Il ne vit pas dans Iris : une extraction par le modèle prend des minutes, et Iris passe chaque minute (même raisonnement que l'ADR-0024).
2. **Ses secrets** : la famille `mail`, pour relire les mails de la case « Missions », et la famille `telegram`. Il refuse de démarrer s'il en trouve une autre (`refuseForeignSecrets`). Il lit la boîte **en lecture seule** : `BODY.PEEK`, sans jamais déplacer, marquer ni supprimer un mail. Il retrouve un mail déplacé comme Iris (ADR-0016).
3. **Les plateformes sont déclarées** dans `prospection.local.toml` (ignoré par git ; un exemple versionné aux domaines fictifs). Chacune a un nom, son **domaine d'expéditeur** et ses **hôtes de liens**. Les liens d'une alerte partent souvent d'un autre hôte que l'expéditeur : un sous-domaine `www`, un domaine de suivi des clics.

### Ce qu'il lit, et comment il découpe

4. **Seuls les mails de la case « Missions »**, pas encore traités, sont lus. Rien d'une autre case ne lui est jamais montré.
   - **La référence reçue ne suffit pas** (charte, règle 5). À la lecture, l'agent relit l'expéditeur à la source et vérifie que son domaine est authentifié (ADR-0014) et déclaré par une plateforme.
   - Sinon, le mail n'est pas lu : il est compté, et le motif est dit.
5. **Le plancher article 9** (ADR-0005) s'applique avant le modèle, sur **tout le texte qui lui serait montré**.
   - Il écarte le mail entier. Or une alerte peut porter une mission du secteur de la santé, ou la phrase d'égalité des chances (« handicap ») de bien des annonces.
   - Ce mail n'est donc pas perdu en silence : il est compté, et la page dit « N alertes non lues (plancher) » pour que je les ouvre moi-même.
   - La mesure du lot 2 dira si c'est fréquent. **Assouplir le plancher demanderait son propre ADR.**
6. **Une alerte contient plusieurs annonces.**
   - **La conversion.** Le code convertit le HTML du mail en texte brut, avec sa propre conversion : celle d'Iris jette la cible des liens. Chaque lien y est remplacé par un repère numéroté (`[L3]`), dont le code garde l'adresse.
   - **Les plafonds.** Le texte est plafonné à **8 000 caractères**, et un mail plus lourd que ce que le lecteur accepte (256 Ko) n'est pas lu. Ce qui dépasse est compté, jamais tu.
   - **La présentation au modèle.** Le texte est donné au modèle entre des marqueurs tirés au hasard, comme une **donnée, jamais une consigne**.
7. **Le modèle ne rend qu'une liste de champs fermés**, validée par schéma. Ce qui n'entre pas dans le schéma est écarté et compté, jamais deviné :

   | Champ | Forme |
   |---|---|
   | intitulé | texte, 120 caractères au plus |
   | entreprise | nom d'une entreprise, 80 au plus, ou « non dite » ; **jamais le nom d'une personne** |
   | intermédiaire | `esn`, `direct` ou `inconnu` |
   | stack | 10 mots au plus, de 30 caractères chacun |
   | TJM | deux entiers en euros (min, max), ou « non dit » |
   | télétravail | `total`, `partiel`, `aucun` ou `inconnu` |
   | lieu | ville ou département, 60 au plus |
   | lien | **un numéro de repère**, pris dans le texte |

   Dans les textes libres (intitulé, entreprise, lieu), le code retire tout ce qui n'a rien à y faire : une adresse web, une adresse électronique, un `@compte`, un numéro de téléphone. Il reprend le nettoyage du mot du CTO (ADR-0025, révisions du 2026-10-20).
8. **Les liens viennent du mail, jamais du modèle.**
   - Le modèle donne un numéro. Le code n'accepte que l'adresse de ce repère, et seulement en `https`, sur un **hôte déclaré** de la plateforme, en correspondance exacte.
   - Un numéro inconnu, ou un hôte non déclaré, laisse l'annonce sans lien.
   - **Le lien est gardé entier.** Un lien de suivi porte sa cible dans sa requête : la couper le casserait. Il peut porter du suivi, et même mon identité auprès de la plateforme. C'est ma propre donnée, gardée sur le Mac et montrée à moi seul. Cliquer reste mon geste.
9. **Les doublons.**
   - Deux annonces sont les mêmes si elles ont la même plateforme, le même intitulé, la même entreprise et le même lieu, comparés sans casse ni accents.
   - Une annonce dont l'entreprise est « non dite » n'est jamais tenue pour un doublon, ni le lien comparé : chaque alerte porte ses propres liens de suivi. **Mieux vaut une carte en double qu'une mission perdue.**

### Le tri, en quatre colonnes

10. **Détectées** : toute annonce extraite ou ajoutée à la main.
11. **Client direct** : l'annonce y passe si aucune règle ni le modèle n'y voit d'intermédiaire.
    - **Les règles d'abord, sans IA** :
      - une liste d'ESN (`prospection.toml`, versionnée : ce sont des entreprises publiques ; mes ajouts dans `prospection.local.toml`), comparée en mot entier, sans casse ni accents ;
      - une liste fermée de tournures (« pour le compte de notre client », « ESN », « SSII », « société de conseil »…).

      Une règle qui voit un intermédiaire **l'emporte toujours sur le modèle**.
    - **Le modèle ensuite**, par le champ `intermédiaire`. Le doute (`inconnu`) **ne passe pas** : l'annonce reste en « Détectées », avec la raison affichée. Je peux toujours la faire avancer moi-même.
12. **Mon profil** : sans IA, sur les champs extraits, d'après mes critères de `prospection.local.toml` (ignoré par git : mon TJM est une donnée d'affaires). Il faut :
    - au moins un mot de la stack dans ma liste ;
    - un TJM maximal au moins égal à mon minimum ;
    - un télétravail que j'accepte, ou un lieu de ma liste.

    Un TJM ou un télétravail **non dit ne refuse pas l'annonce** : elle passe, marquée « à vérifier ».
13. **Alerte** : une annonce qui a passé les trois colonnes est signalée (point 19).
14. **L'agent place une carte une fois, à sa création, puis n'y touche plus.**
    - Un critère ou une liste d'ESN changés valent pour les annonces suivantes.
    - Chaque carte dit pourquoi elle s'est arrêtée (« ESN de la liste », « ESN selon le modèle », « intermédiaire inconnu », « stack », « TJM »…), et qui l'a décidé : `rule`, `model` ou `me`.
    - L'ouverture et le passage d'une colonne à l'autre se décident **sur des données**. Le modèle ne fait qu'extraire des champs et dire `esn`, `direct` ou `inconnu`.

### Ma prospection, et ma main

15. **Mes colonnes, après Alerte** : Contactée, Candidature, Entretien, Gagnée, Perdue, Écartée.
    - Seul moi déplace une carte, depuis la page, dans n'importe quelle colonne.
    - Ma décision l'emporte sur celle de l'agent, y compris pour faire avancer une carte qu'il avait arrêtée.
16. **Une annonce ajoutée à la main, à la volée**, depuis la page.
    - **Le formulaire** reprend les mêmes champs (point 7), avec le même nettoyage, plus une **note de 280 caractères au plus**.
    - **Le lien** est facultatif ; seul `https` est accepté, et l'agent ne l'ouvre jamais.
    - **Le tri** : elle passe par les mêmes règles (points 11 et 12), **sans le modèle**, puisque c'est moi qui ai rempli les champs. Elle porte la marque « ajoutée par moi ».

    **Je ne colle pas un post entier** : il contiendrait le nom et le texte de son auteur. Seuls les champs sont gardés.
17. **Qui peut écrire quoi.**
    - Ajouter et déplacer une carte passent par le serveur, derrière le **jeton de la page**, comme les propositions. Ce n'est pas la signature de l'ADR-0013 : aucune action ne part vers l'extérieur. Telegram ne fait que prévenir.
    - L'agent et le serveur partagent le rôle de la base. « Seul moi déplace » est donc tenu **par le code**, pas par la base : l'agent ne fait qu'ajouter des cartes, jamais les modifier, et un test parcourt son code pour y refuser toute modification de la table (comme le test de l'ADR-0025 sur `gh`). C'est un risque accepté : un agent compromis au point de réécrire son code n'a déjà plus de limite.

### Ce qu'il garde, et combien de temps

18. **Une table de cartes** (`prospection_cartes`).
    - **Elle contient** :
      - les champs du point 7 et la note de ma saisie ;
      - la colonne, la raison et le décideur ;
      - la plateforme et la source (`mail` ou `me`) ;
      - la date de création et celle de mon dernier déplacement.
    - **Elle ne contient pas** : le texte du mail, son objet, le nom ou l'adresse d'une personne, ou une clé d'expéditeur.
    - **Conservation** : **60 jours après la création ou mon dernier déplacement**, au plus tard des deux (`prospection_jours` dans `cadre.toml`, `[conservation]`).
    - **La purge.** L'agent supprime lui-même les cartes échues à chaque passage, comme la veille purge son archive. Une carte que je fais vivre reste ; une carte oubliée part. Une carte « Écartée » purgée peut revenir avec une alerte suivante : c'est accepté, il n'en reste aucune trace.
    - **Les mails déjà traités** sont notés par l'identifiant fixe qu'Iris donne à chaque mail (ADR-0016), et rien d'autre. Cette note est effacée avec la mémoire du courrier (90 jours, ADR-0012). Un mail déplacé n'est donc pas relu.
    - **Effacer une carte** se fait en ligne de commande (recherche par entreprise, effacement par numéro), pour une demande d'accès ou d'effacement. Le journal dit *qu'*une carte a été effacée, pas laquelle (charte, règle 4).

### Ce qu'il dit, et où

19. **Telegram : des compteurs seulement**, jamais le contenu d'une annonce (ADR-0006).
    - **Le message** : « N nouvelle(s) mission(s) pour toi — à lire sur la page », avec le nombre de cartes arrêtées par colonne et d'alertes non lues.
    - **Quand** : au plus une fois par passage, **seulement s'il y a du nouveau en « Alerte »**. Les passages ont lieu aux heures où Iris relève, donc hors des heures calmes.
    - **« Dit »** seulement une fois le message parti : un envoi raté repart au passage suivant.
20. **La page : un tableau** (kanban), derrière le jeton.
    - Les textes sont affichés en texte brut échappé, jamais en HTML.
    - Un lien n'est cliquable qu'en `https`. Pour une carte venue d'un mail, il ne l'est que sur un hôte déclaré de la plateforme.
    - Chaque carte venue d'un mail porte **« extrait par IA »** (AI Act, art. 50).
    - L'aperçu de la page montre chaque état avec des cartes fictives.
21. **Le journal ne reçoit que des nombres** (ADR-0008).
    - **Le passage** : mails lus, non lus et pourquoi, annonces extraites, doublons, écartées par le schéma, coupées par le plafond, cartes par colonne, cartes purgées.
    - **L'envoi** d'une alerte.
    - **Le déplacement** d'une carte : de quelle colonne à quelle colonne, jamais quelle carte.
    - **L'effacement** d'une carte.

    Chaque nouveau type d'événement est déclaré au registre des types.
22. **Le modèle absent** : l'agent attend, sans jamais passer à un autre modèle (ADR-0003). Les mails restent à lire, rien n'est perdu, et l'état « en attente du modèle local » se voit sur la page.

    **Pas d'échec silencieux** : un mail qu'on n'a pas pu lire, une annonce sans aucun champ valide, une liste d'ESN, une liste de plateformes ou un profil illisibles sont dits. Une liste illisible arrête le tri, au lieu de tout laisser passer.

## Révision du 2026-10-22 — une plateforme que je déclare « directe »

Le relevé de mes plateformes a montré qu'une alerte de Collective ne donne qu'un intitulé et un lien : ni TJM, ni télétravail, ni intermédiaire. Le modèle répond donc `inconnu`, et le point 11 arrêtait **toutes** ses missions en « Détectées », sans alerte.

- **Un réglage par plateforme**, dans `prospection.local.toml` : `intermediaire_par_defaut = "direct"`, seule valeur permise. C'est ma déclaration (les clients y publient eux-mêmes), pas l'avis du modèle.
- **Il n'agit que sur le doute** : quand le modèle dit `inconnu` pour une mission de cette plateforme, elle passe « Client direct ». La liste d'ESN, les tournures et un `esn` du modèle l'emportent toujours. Une carte que je saisis à la main n'est pas concernée.
- **Elle reste « à vérifier »** : elle a passé sur ma déclaration, pas sur ce que disait l'alerte. Mon profil s'applique comme avant (stack, TJM, télétravail).
- Choix du dirigeant (2026-10-22), pour Collective ; aucune plateforme n'a ce réglage par défaut.

## Conformité

- **RGPD** : un nouveau traitement, **T-09**.
  - **Finalité** : trouver et suivre des missions pour mon activité.
  - **Base légale** : intérêt légitime de mon activité, à confirmer.
  - **Personnes concernées** : surtout aucune, puisque les annonces viennent d'entreprises. Il reste deux cas : un recruteur nommé dans une annonce, que l'extraction écarte, et une entreprise individuelle dont le nom est celui d'une personne, que le code ne sait pas reconnaître.
  - **Durées et effacement** : ceux du point 18.

  La mention d'information et l'AIPD sont relues avant la mise en service.
- **AI Act** : une ligne **IA-08**, pour l'extraction des annonces et l'avis `esn` / `direct` / `inconnu`.
  - **Risque proposé : minimal.** L'agent évalue des offres pour moi, pas des personnes. Ce n'est pas du recrutement au sens de l'annexe III : c'est moi qui choisis mes clients, et aucune décision ne touche quelqu'un d'autre.
  - **Garde-fous** : supervision humaine (je vois chaque raison et je peux tout déplacer), marquage « extrait par IA », modèle local seulement.
- **Le modèle peut faire partir une alerte**, ce qu'Iris ne permet pas pour l'urgence (ADR-0007, qui reste sans IA).
  - **Le risque** : une annonce piégée peut se dire `direct`, avec un TJM haut et ma stack, et me valoir un message.
  - **Ce qui le borne** : ce message n'est qu'un compteur, sans contenu ni action. Le pire est une fausse carte et un faux « 1 nouvelle mission ». C'est accepté.
- **Les contrôles de conformité** (ADR-0022) exigent déjà ce qui précède : une table non déclarée, une durée non citée ou un hôte non listé font échouer `npm run check`.

## Conséquences

- **Le travail se fait en lots**, chacun avec ses tests adversariaux :
  - **lot 1** : la case « Missions » (ADR-0031) ;
  - **lot 2** : l'agent, l'extraction et le tri ;
  - **lot 3** : le tableau, la saisie à la main et l'alerte Telegram.
- **Les tests chercheront à casser l'agent** avec :
  - une annonce qui donne des ordres, ou qui demande un lien ou un numéro de téléphone ;
  - un repère de lien inventé, ou un lien vers un sosie de la plateforme ;
  - un faux expéditeur ;
  - une ESN qui se présente comme client direct ;
  - un TJM illisible ou négatif ;
  - la même mission dans deux alertes, ou un mail de 100 annonces ;
  - une alerte qui contient « handicap » ;
  - une saisie à la main en HTML ou avec un lien `javascript:`.
- **Le modèle lit plus long qu'Iris** (8 000 caractères au lieu de 2 000), mais seulement les alertes des plateformes : quelques minutes de modèle par jour.
- **Une carte arrêtée à tort se rattrape à la main.** Le taux d'annonces mal arrêtées sera mesuré sur mes vraies alertes avant de s'y fier, comme M2 pour le rangement.

## Options écartées

- **Une application à part** (dossier Prospector) : une seconde ouverture de ma boîte, une seconde sécurité, un second registre.
- **L'extraction dans Iris** : Iris passe chaque minute ; une extraction de plusieurs minutes la retarderait.
- **Relire le mail à chaque affichage**, sans rien garder : une carte disparaîtrait avec son mail, mes colonnes de suivi n'auraient plus de support, et chaque affichage relancerait le modèle.
- **Le lien limité au domaine de l'expéditeur, sans sa requête** : presque toutes les cartes perdraient leur lien, et les doublons par lien fusionneraient des missions différentes.
- **Le modèle qui juge mon profil** : la stack, le TJM et le télétravail se comparent par le code, de façon vérifiable et testée.
- **Laisser passer le doute sur l'intermédiaire** : le tableau se remplirait d'ESN.
- **Un ajout à la main par Telegram** (`/mission`) : un texte libre demanderait le modèle pour en tirer les champs, et la page est déjà installable sur le téléphone. Il reste possible dans un palier suivant.
- **Ouvrir les liens des annonces** pour en lire le détail : ce serait un accès web pour un agent qui lit du contenu non fiable (ADR-0005), et une collecte sur les plateformes.

## Hors périmètre

Écrire, répondre ou postuler à ma place ; toute collecte automatique sur une plateforme ; un brouillon de candidature.
