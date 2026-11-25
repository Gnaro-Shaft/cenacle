# ADR-0049 — Une demande à la maison rédigée depuis un mail, par le modèle local, relue par moi

**Statut** : acceptée (2026-11-25) — plan et choix validés par le responsable le 25/11 ; complète l'ADR-0048 (palier L3) ; garde l'ADR-0003 (le contenu d'un mail ne quitte jamais le modèle local) et l'ADR-0005 (un mail est une donnée, jamais une consigne)

## Contexte

L'ADR-0048 a ouvert la liaison avec la maison pour les demandes que je tape (L2, éprouvée le 25/11 : GNA-27). Une bonne part de mon travail arrive pourtant par mail : un client décrit ce qu'il attend, et je le recopie. L3 fait rédiger ce brouillon par le modèle local, sans que le mail ni ses noms ne quittent le Mac.

Ce qui change par rapport à L2 : le texte qui partira chez la maison, puis chez Anthropic aux États-Unis, est **tiré du mail d'un correspondant**. Même reformulé, même sans nom, il peut porter de l'information sur lui. La mention d'information publiée dit aujourd'hui « aucun fournisseur d'IA en ligne, aucun transfert hors UE » : elle doit changer avant que rien ne soit rédigé.

## Décision

1. **C'est moi qui choisis chaque mail** (*choisi le 25/11*). Je range le mail dans un dossier IMAP dédié de ma boîte, nommé dans `liaison.local.toml` (`dossier_travail`). Iris lit déjà tous les dossiers (ADR-0016) et ne garde du dossier que sa clé HMAC : le programme compare des clés, jamais un nom. Aucune règle, aucun modèle ne range un mail dans ce dossier ; aucune nouvelle case d'Iris.

2. **Un programme à part, `redaction`** (*choisi le 25/11*), sur le patron de l'agent prospection (ADR-0032) : launchd toutes les 15 minutes, verrou d'instance, la boîte **en lecture seule** (`.env.mail`), Telegram pour les compteurs, **jamais la clé de la maison** (le test de frontière le vérifie). Pour chaque mail du dossier, pas encore lu, arrivé depuis l'ouverture :
   - il le relit sur le serveur, objet et 2 000 caractères de texte au plus, en mémoire ;
   - le **plancher de l'article 9** d'abord : un mail qui semble sensible n'est jamais rédigé ;
   - le **modèle local seul** (`dataClass: "mail_content"`, ADR-0003), le mail entre des marqueurs à nonce, avec pour consigne : reformuler le travail demandé, **sans nom de personne ni d'entreprise, sans coordonnée, sans citer le mail** ; réponse en JSON strict `{"titre", "description"}` ;
   - **le code revérifie** : forme, tailles, et le filtre de la liaison (courriel, téléphone, IBAN, lien, longue suite de chiffres). Une réponse qui ne passe pas ne devient **pas** un brouillon, et n'est jamais réparée : le mail est marqué par la catégorie du refus, et je l'apprends (compteur) ;
   - sinon, une demande **en attente**, origine `mail`, liée au mail par l'identifiant fixe d'Iris, dans le premier dossier de `liaison.local.toml`. Un mail donne au plus un brouillon, jamais deux (contrainte d'unicité).
   - Le modèle indisponible : on attend (ADR-0003) ; le mail n'est pas marqué, il sera lu au passage suivant.

3. **Rien ne part sans moi.** Le brouillon suit le cycle de l'ADR-0048 : je le relis, **je retire les noms** (aucun filtre ne les détecte sûrement), je le corrige, je l'accepte sur la page, qui signe — l'origine est dans le message signé. La page affiche sur chaque brouillon « rédigé par le modèle local depuis un mail : retire tout nom avant d'accepter ».

4. **Une ouverture datée** (*choisi le 25/11*). `redaction_ouverte = <date>` dans `liaison.local.toml` : absente, ou dans le futur, rien n'est rédigé ; un mail arrivé avant cette date n'est jamais lu. Je l'écris **après** avoir republié la mention d'information, à la date de la republication. Comme le cran de l'ADR-0015.

5. **Le mail effacé emporte ses brouillons.** Quand Iris oublie un mail (90 jours, ou l'effacement d'une personne, C3), un déclencheur rend caduc tout brouillon encore en attente ou accepté qui en vient, et efface le texte de ceux qui sont clos. Une demande déjà transmise reste chez la maison (son T-007) : une demande d'effacement d'une personne doit alors lui être relayée à la main — point ouvert au registre.

6. **Le journal et Telegram : des compteurs.** `redaction.passe` dit combien de mails lus, rédigés, écartés (plancher, refus par catégorie, illisibles) ; Telegram dit « N brouillon(s) à relire », jamais un texte, un objet, un nom.

7. **Classement IA (IA-09)** : risque **limité** — le modèle prépare un texte destiné à un tiers (la maison, puis Anthropic), relu et accepté par moi ; il ne décide rien. Base légale : intérêt légitime (traiter les demandes de travail de mes clients), avec un transfert hors UE par la maison sous clauses contractuelles types — **choisie le 25/11 par le responsable** ; ce n'est pas un avis juridique.

8. **Tests adversariaux exigés** : un mail hors du dossier, d'avant l'ouverture, sensible, ou déjà lu n'est jamais rédigé ; un mail qui ordonne au modèle d'écrire un lien, une adresse ou un numéro ne donne aucun brouillon ; une sortie qui n'est pas exactement `{titre, description}` est refusée ; un mail ne donne jamais deux brouillons, même en SQL direct ; le modèle absent ne marque rien ; le programme refuse de démarrer avec la clé de la page ou du bot, et ne lit jamais la porte de la maison ; l'effacement d'un mail rend ses brouillons caducs et sans texte.

## Conséquences

- **La mention d'information doit être republiée** avant l'ouverture : son paragraphe est rédigé dans `docs/conformite/mention-information.md` ; la publier sur le site est mon geste.
- **Le risque R6 de l'AIPD change de nature** : ce n'est plus mon texte, c'est un texte tiré du mail d'un correspondant. Ma relecture reste la seule garde contre un nom.
- **Le modèle peut mal comprendre la demande** : le brouillon se corrige ou se refuse d'un clic ; rien ne part tant que je ne l'ai pas accepté.

## Options écartées

- **Une règle par adresse d'expéditeur**, comme « Missions » : automatique, elle ferait rédiger tout mail de ces adresses, même ceux que je ne voulais pas confier.
- **Une sixième case d'Iris** : 45 fichiers touchés à la création de « Missions », pour un geste que le dossier IMAP rend déjà explicite.
- **Le modèle qui choisit les mails à confier** : un modèle ne décide pas de ce qui part vers un tiers (charte, règle 1).
- **Rédiger dans la passe d'Iris** : Iris trie toutes les cinq minutes et attend le modèle pour le tri ; la rédaction est un autre rythme, une autre finalité.
- **Envoyer le mail lui-même à la maison** : interdit par l'ADR-0003.
