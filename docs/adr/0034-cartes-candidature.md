# ADR-0034 — Les cartes « Candidature », créées depuis les confirmations des plateformes

**Statut** : acceptée (2026-10-24) — complète l'ADR-0032 (révise son point 15 : seul moi place une carte dans mes colonnes) ; s'appuie sur l'ADR-0031 (la case « Missions »)

## Contexte

Le tableau de prospection (ADR-0032) suit mes démarches dans des colonnes que je suis seul à remplir : Contactée, Candidature, Entretien, Gagnée, Perdue, Écartée. Il reste un trou :

- **Une partie des missions n'arrive jamais par une alerte e-mail.** Une des plateformes que j'utilise, par exemple, ne propose aucune alerte : ses offres ne se voient qu'une fois connecté (vérifié le 2026-10-24). Les récupérer automatiquement est exclu : ce serait de la collecte sur une plateforme (ADR-0032, hors périmètre), plus un secret de connexion et un accès web pour un agent qui lit du contenu non fiable (ADR-0005).
- **En revanche, quand je postule, la plateforme m'envoie une confirmation.** Ce mail atteste un fait que j'ai moi-même créé : j'ai postulé à telle mission, chez telle entreprise.
- **Aujourd'hui, je dois recopier chaque candidature à la main**, avec « Ajouter une mission repérée ». En pratique, je l'oublie, et le suivi est incomplet.

Il faut donc qu'une confirmation de candidature devienne une carte en « Candidature », sans que l'agent gagne un droit d'agir, et sans rien collecter de plus que pour les alertes.

## Décision

### 1. Les adresses de confirmation, déclarées par plateforme

- **Dans `prospection.local.toml`**, une plateforme peut porter une liste `adresses_candidature` : les **adresses exactes** dont elle envoie ses confirmations. Elles sont souvent distinctes de l'adresse de ses alertes. Pas de joker ; le domaine de chaque adresse doit être le domaine de la plateforme.
- **Une plateforme peut n'avoir que des confirmations**, sans alerte, comme celle du contexte. Elle est déclarée comme les autres (nom, domaine, hôtes de liens).
- **Iris range ces mails en « Missions »** par la règle de l'ADR-0031 : chaque adresse de confirmation est aussi ajoutée à `[missions] adresses` de `regles.local.toml`, avec les mêmes exigences (adresse exacte, domaine authentifié, ADR-0014). Sans cela, l'agent ne voit jamais le mail.
- **Le relevé** (`npm run prospection:releve`) liste aussi les adresses d'où viennent mes confirmations, pour que je les déclare. Il reste réservé au terminal, car les adresses réelles ne passent pas par un assistant.

### 2. Le chemin d'une confirmation

L'agent lit la case « Missions » comme avant (ADR-0032, points 4 à 8). Ce qui change :

- **Le tri du mail se fait par le code, sur l'adresse.** Si l'expéditeur, relu à la source et authentifié, est une adresse de confirmation déclarée, le mail prend le chemin « confirmation ». Sinon, il reste une alerte. Le modèle ne décide jamais si un mail est une confirmation : une alerte piégée ne peut pas se faire passer pour une candidature.
- **Le plancher article 9**, le plafond de 8 000 caractères, les repères de liens et les marqueurs aléatoires s'appliquent tels quels.
- **Une seule mission par confirmation.** Le modèle reçoit une consigne à part, qui demande les champs d'une seule mission, validés par le même schéma réduit : intitulé, entreprise (jamais le nom d'une personne), lieu, lien (un numéro de repère). La stack, le TJM, le télétravail et l'intermédiaire ne sont pas demandés : une confirmation les donne rarement, et ils ne servent plus au tri.
- **Si le modèle rend plusieurs missions, ou aucune**, rien n'est créé : le mail est compté (« confirmation illisible »), et la page le dit. Mieux vaut une candidature à ajouter à la main qu'une carte fausse.
- **Le nettoyage des champs** (adresses, `@compte`, téléphone) et la règle des liens (`https`, hôte déclaré, gardé entier) sont ceux de l'ADR-0032.

### 3. La carte

- **Elle est créée directement en « Candidature »**, avec la source `mail`, le décideur `rule` et la raison « candidature confirmée par la plateforme ». C'est le seul cas où l'agent place une carte dans une de mes colonnes. Il ne passe ni par les colonnes de tri (Client direct, Mon profil) ni par l'Alerte : j'ai déjà choisi cette mission en postulant.
- **Elle porte « extrait par IA »** (AI Act, art. 50), comme toute carte venue d'un mail.
- **Pas d'alerte Telegram** : je sais que j'ai postulé. Le compteur du passage la compte, sans plus.
- **Les doublons** :
  - si la même mission (plateforme, intitulé, entreprise, lieu, comparés comme à l'ADR-0032, point 9) a déjà une carte en « Candidature » ou au-delà (Entretien, Gagnée, Perdue), rien n'est créé : c'est une seconde confirmation, ou une relance de la plateforme ;
  - une confirmation dont l'entreprise est « non dite » n'est jamais tenue pour un doublon, comme pour les alertes.

### 4. Une carte déjà présente dans le tableau : l'agent n'y touche pas

Quand je postule à une mission que l'agent avait déjà trouvée (en Alerte, par exemple), deux cartes parlent de la même mission.

- **L'agent ne déplace pas l'ancienne.** Il garde la règle de l'ADR-0032 (point 17) : il **ajoute** des cartes, il n'en **modifie** jamais, et un test parcourt son code pour y refuser toute modification de la table. Ouvrir une exception, même étroite, affaiblirait cette garantie pour un gain de confort.
- **La page les relie à l'affichage** : quand une carte « Candidature » a la même mission qu'une carte d'une colonne de l'agent, la page dit sur l'ancienne « candidature envoyée (voir la carte en Candidature) ». Ce lien est calculé par le serveur à chaque affichage, et rien n'est stocké.
- **C'est moi qui range l'ancienne**, en un geste (Écartée), ou je la laisse partir à la purge.

### 5. Ce qui est gardé

- **Rien de plus que pour les alertes** : la même table (`prospection_cartes`), les mêmes champs, moins ceux qui ne sont pas demandés. On ne garde ni le texte du mail, ni son objet, ni le nom ou l'adresse d'une personne. Une confirmation contient souvent mon propre nom et parfois celui d'un recruteur : aucun des deux n'entre dans un champ.
- **La même conservation** : 60 jours après la création ou mon dernier déplacement (`prospection_jours`). Une candidature que je fais avancer reste ; une candidature sans suite part.
- **La même marque de mail lu** (l'identifiant fixe d'Iris), effacée avec la mémoire du courrier.

### 6. Ce qui est dit

- **Le journal** ne reçoit que des nombres : le compteur du passage gagne « confirmations lues », « cartes Candidature créées », « confirmations en doublon » et « confirmations illisibles ». Aucun nouveau type d'événement n'est nécessaire.
- **La page** montre les confirmations illisibles comme les alertes non lues : « N confirmations à ajouter à la main ».

## Conformité

- **RGPD** : pas de nouveau traitement. **T-09** a déjà pour finalité de « suivre mes démarches ». On y ajoute une **nouvelle source** (les confirmations des plateformes, dont des plateformes sans alerte) et rien d'autre : mêmes champs, même durée, même base légale (intérêt légitime, validée le 2026-10-22).
  - **Le registre des traitements** (T-09) nomme cette source.
  - **La mention d'information** : le paragraphe « Les alertes de missions » ne parle que des alertes. Il dit qu'un assistant relève les missions des alertes. Il devra dire aussi « et des confirmations de candidature ». **Je le republie avant la mise en service** : la publication est mon geste, comme le 2026-10-22.
  - **L'AIPD** n'est toujours pas requise. Rien ne change dans ce qui la déclencherait : pas de profilage, pas de donnée sensible, pas de décision sur une personne.
- **AI Act** : **IA-08** s'étend à l'extraction des confirmations. Le risque reste **minimal** : le modèle relève les champs d'une mission à laquelle j'ai postulé, sans décider de rien (la colonne est fixée par le code, sur l'adresse).
- **Les contrôles de conformité** (ADR-0022) continuent de s'appliquer.

## Conséquences

- **Un lot**, avec ses tests adversariaux :
  - l'adresse de confirmation dans `prospection.local.toml`, et le relevé qui les liste ;
  - le chemin « confirmation » dans l'agent, sa consigne et son schéma ;
  - le lien affiché entre deux cartes de la même mission ;
  - le registre, la mention (à republier) et IA-08.
- **Les tests chercheront à casser** avec :
  - une alerte ordinaire qui se dit « confirmation de candidature » (elle doit rester une alerte : seule l'adresse compte) ;
  - une confirmation envoyée depuis une adresse non déclarée ou non authentifiée ;
  - une confirmation qui contient deux missions, ou aucune ;
  - une confirmation qui nomme un recruteur, ou qui ne contient que mon propre nom ;
  - la même confirmation reçue deux fois ;
  - une confirmation qui contient « handicap » (plancher article 9) ;
  - un lien vers un sosie de la plateforme ;
  - une carte déjà en Alerte pour la même mission (elle ne bouge pas, et la page les relie).
- **Je dois déclarer les adresses** : sans `adresses_candidature` et la règle `[missions]` correspondante, rien ne change.
- **Les candidatures envoyées autrement** (par mail direct à un client, par téléphone) restent à ajouter à la main : il n'y a pas de confirmation à lire.

## Options écartées

- **Le modèle qui reconnaît une confirmation** (« ce mail est-il une candidature ? ») : une alerte piégée pourrait se faire passer pour une candidature et ouvrir une carte dans une de mes colonnes. L'adresse déclarée est vérifiable et testée.
- **L'agent qui déplace la carte existante en « Candidature »** : c'est le geste le plus confortable, mais il faudrait une exception à « l'agent ne modifie jamais une carte » (ADR-0032, point 17), et un test plus faible. **À reconsidérer** si le lien affiché ne suffit pas à l'usage.
- **Lire les confirmations hors de la case « Missions »** : il faudrait montrer à l'agent des mails d'une autre case, ce que l'ADR-0032 exclut (point 4).
- **Un analyseur écrit à la main pour chaque plateforme** : il serait précis, mais il casserait à chaque changement de gabarit, sans prévenir. Le modèle, encadré par un schéma, résiste mieux, et une réponse qui ne rentre pas dans le schéma est dite.
- **Récupérer les offres d'une plateforme sans alerte en s'y connectant** : c'est exclu par l'ADR-0032 (collecte) et l'ADR-0005 (accès web), et cela demanderait un secret de plus.
- **Créer aussi une carte « Perdue » depuis les mails de refus** : utile, mais c'est un second chemin, avec ses propres pièges (un refus mal lu fermerait une candidature vivante). Il viendra dans un autre ADR, si le besoin se confirme.

## Hors périmètre

Postuler, répondre ou relancer à ma place ; lire un mail hors de la case « Missions » ; ouvrir un lien ; toute collecte sur une plateforme.
