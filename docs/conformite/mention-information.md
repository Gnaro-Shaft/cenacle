# Mention d'information — Cénacle (à publier avant l'ouverture)

> Jalon C4 de la phase 5. Rédigé par Claude le 2026-10-04 ; ce n'est pas un avis
> juridique. **La publication est le geste du responsable**, dans les mentions
> légales du site, à la suite des paragraphes existants. Elle est ensuite
> **vérifiée en ligne**, pas supposée, et sa date est inscrite dans `cadre.toml`
> (`mention_publiee`) quand le traitement s'ouvre (ADR-0009, C1).
>
> Aucune adresse réelle ici : « l'adresse indiquée plus haut » renvoie à celle
> que la page publie déjà.

## Ce que la mention publiée dit aujourd'hui (lue en ligne le 2026-10-04)

La page, mise à jour le 29 septembre 2026, décrit déjà :

- **l'outil de suivi des messages** (Legion, son traitement T-002) : domaine de l'expéditeur, taille, état ; ni objet, ni contenu, ni adresse complète ; 30 jours ;
- **l'assistant de travail** (Myriade) : intelligence artificielle sur mes propres machines ; « il n'envoie rien : je relis et j'envoie moi-même » ;
- les droits, l'adresse pour les exercer, le délai d'un mois et la CNIL.

**L'aide de l'IA y est signalée** (paragraphe « Mon assistant de travail »).

## Ce qui deviendrait faux avec Cénacle

| Phrase publiée | Pourquoi elle ne suffit plus |
|---|---|
| « Il n'enregistre ni l'objet, ni le contenu, ni l'adresse complète, ni le nom » (outil de suivi) | Vrai pour l'outil de suivi. Cénacle **lit** l'objet et le texte, en mémoire, par un modèle local, et garde une **clé dérivée** de l'adresse complète |
| « Il n'envoie rien : je relis et j'envoie moi-même » (assistant de travail) | Vrai pour l'assistant de travail. Cénacle **envoie** ce que j'ai accepté, depuis ma boîte, après un délai d'annulation |
| « Ces informations techniques sont conservées 30 jours » | Les durées de Cénacle sont 90 jours, 7 jours et 180 jours |

Ces phrases restent justes pour les outils qu'elles décrivent. Il suffit donc d'**ajouter** un paragraphe propre à Cénacle, qui dise en quoi il diffère, plutôt que de réécrire les autres.

## Paragraphe à ajouter

### Mon assistant de messagerie

Pour trier ma boîte professionnelle et préparer mes réponses, j'utilise un second assistant, fondé lui aussi sur l'intelligence artificielle. Il fonctionne uniquement sur mon propre ordinateur, en France. Contrairement à l'outil de suivi décrit plus haut, il **lit** les messages que vous m'écrivez.

**Ce qu'il lit, et ce qu'il garde.** À chaque relevé, il lit l'objet et le texte de vos messages (au plus 2 000 caractères), le temps de les ranger : client ou prospect, administratif, information sans réponse attendue, ou à trier par moi. Il n'en garde rien : ni l'objet, ni le texte, ni votre nom. Il retient seulement un identifiant technique attribué par le serveur de messagerie, la date d'arrivée, la case choisie, et une **clé dérivée** de votre adresse, calculée avec un secret qui ne quitte pas mon ordinateur. Cette clé lui permet de savoir si je vous ai répondu, sans conserver votre adresse.

**Ce qu'il me propose.** Quand un message de client ou de prospect attend ma réponse depuis 48 heures ouvrées, il peut me proposer un brouillon : une de mes réponses types, dont quelques mots sont repris de votre message (par exemple le créneau que vous proposez). Il ne rédige pas le reste, et il ne peut pas inventer un fait : un nombre, une date, un montant, un lien ou une adresse absents de votre message sont refusés par une vérification qui n'utilise pas l'intelligence artificielle.

**Ce qu'il fait seul, et ce qu'il ne fait pas.** Il n'envoie rien sans moi. Je relis chaque brouillon, je le corrige, et je l'accepte ou le refuse. Une réponse acceptée part depuis ma boîte, à votre seule adresse, après un délai de deux minutes pendant lequel je peux encore l'annuler. Elle porte un en-tête technique (`X-AI-Assisted`) qui indique qu'elle a été préparée avec l'aide de l'intelligence artificielle, puis relue et acceptée par moi. Il ne prend aucune décision vous concernant et ne dresse aucun profil.

**Les données sensibles.** Un message qui semble révéler une donnée sensible (santé, opinions, convictions, appartenance syndicale, origine, vie sexuelle, données génétiques ou biométriques, condamnations) n'est jamais lu par l'intelligence artificielle. Il m'est laissé, à trier moi-même, et aucun brouillon n'est proposé. Le motif n'est pas enregistré. Ce filtre repose sur une liste de mots : il réduit le risque, sans pouvoir l'annuler.

**Aucun tiers.** Il ne fait appel à aucun service extérieur : aucun fournisseur d'intelligence artificielle en ligne, aucun transfert hors de l'Union européenne, aucun sous-traitant ajouté. Votre message reste chez l'hébergeur de ma messagerie, en France, comme avant. Je reçois sur mon téléphone des compteurs (« 3 messages en attente »), jamais le contenu d'un message.

**Combien de temps.** Ce qu'il retient d'un message est effacé 90 jours après son arrivée. Le texte d'un brouillon est effacé 7 jours après que j'ai décidé de son sort, et la trace de cette décision 90 jours après. Son journal, qui ne contient ni contenu, ni adresse, ni nom, est effacé au bout de 180 jours. Votre message lui-même reste soumis aux trois ans indiqués plus haut.

**Pourquoi.** Ne laisser aucun message sans réponse, et vous répondre plus vite. Ce traitement repose sur mon intérêt légitime à organiser mon activité (article 6.1.f du RGPD), qui sert autant votre intérêt que le mien.

**Vos droits.** Les droits décrits plus haut valent aussi ici, à l'adresse indiquée plus haut, avec une réponse sous un mois et la possibilité de saisir la CNIL. Sur demande, je vous remets ce qu'il détient sur vous, dans un format structuré. Si vous demandez l'effacement ou vous opposez à ce traitement, tout ce qu'il retient de vous est effacé, et vos messages ne sont plus jamais lus par lui. Il ne garde alors que la clé dérivée de votre adresse, et seulement pour respecter votre choix, jusqu'à ce que vous reveniez dessus.

Ce paragraphe date du _[date de publication]_. L'assistant ne lit que les messages reçus à partir de cette date.

## À trancher avant publication

1. ~~**Les messages reçus avant la publication.**~~ **Fait le 2026-10-04** : la relève ignore tout message reçu, et tout message envoyé, avant minuit (heure de Paris) du jour inscrit dans `mention_publiee` (`readingStartsAt`). La dernière phrase du paragraphe est donc tenue par le code.
2. ~~**Le marquage dans le mail lui-même**~~ **Décidé le 2026-10-04** : chaque réponse envoyée porte l'en-tête `X-AI-Assisted: draft-by-local-model; reviewed-and-accepted-by-sender`, lisible par machine, invisible pour le lecteur ; la mention le dit.
3. **La relecture par un juriste** : pas de juriste disponible ; le responsable choisit de publier en l'état (2026-10-04). Ce texte n'est pas un avis juridique.
