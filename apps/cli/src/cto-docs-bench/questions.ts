/**
 * The bench of the CTO's documentation (ADR-0033, § 6), written before the
 * context it measures: questions whose answer is IN the versioned
 * documentation, each with the points an answer must give. At least half bear
 * on an old ADR — the kind the new context may leave to the map.
 *
 * The criteria are fixed here, in their own commit: never fitted to a result.
 * A point counts when its pattern matches anywhere in the answer; a question
 * is right when all its points are given. No real data in any question.
 */

export interface DocsQuestion {
  readonly id: string;
  readonly question: string;
  /** The document that holds the answer: every point must match its text. */
  readonly source: string;
  /** One pattern per expected point. */
  readonly points: readonly RegExp[];
}

const THIRTY_SECONDS = /\b30\s*(?:s\b|secondes)|trente secondes/i;

export const QUESTIONS: readonly DocsQuestion[] = [
  {
    id: "Q01",
    question:
      "Entre le moment où j'accepte une proposition de réponse et l'envoi réel, quel délai d'annulation ai-je ? Et combien d'envois au plus par jour ?",
    source: "docs/adr/0004-propositions-et-validation.md",
    points: [/\b2\s*min|deux minutes/i, /\b20\b|vingt/i],
  },
  {
    id: "Q02",
    question:
      "Combien de temps la mémoire du courrier garde-t-elle un mail, et sous quelle forme l'adresse de l'expéditeur y est-elle stockée ?",
    source: "docs/adr/0012-memoire-du-courrier.md",
    points: [/\b90\s*jours|quatre-vingt-dix jours/i, /HMAC/],
  },
  {
    id: "Q03",
    question:
      "Avec quel algorithme la page signe-t-elle mon acceptation d'une proposition, et quel programme vérifie cette signature avant d'envoyer ?",
    source: "docs/adr/0013-qui-accepte.md",
    points: [/Ed25519/i, /ex[ée]cuteur/i],
  },
  {
    id: "Q04",
    question:
      "Pourquoi un résultat SPF ne suffit-il jamais, à lui seul, à tenir un expéditeur pour authentifié ?",
    source: "docs/adr/0014-authentification-expediteur.md",
    points: [/enveloppe/i, /\bFrom\b/],
  },
  {
    id: "Q05",
    question: "À partir de combien de dossiers Iris refuse-t-elle de lire une boîte ?",
    source: "docs/adr/0016-tous-les-dossiers.md",
    points: [/\b200\b|deux cents/i],
  },
  {
    id: "Q06",
    question:
      "Quand une deuxième Iris essaie de démarrer alors qu'une première tourne, avec quel code de sortie refuse-t-elle ? Et combien de temps launchd attend-il entre deux démarrages ?",
    source: "docs/adr/0018-iris-sous-launchd.md",
    points: [/\b75\b/, THIRTY_SECONDS],
  },
  {
    id: "Q07",
    question:
      "Tous les combien le verrou d'instance d'Iris est-il contrôlé, et pourquoi le recyclage des connexions a-t-il été désactivé pour lui ?",
    source: "docs/adr/0023-verrou-repris-apres-coupure.md",
    points: [THIRTY_SECONDS, /l[âa]ch|perd|perte/i],
  },
  {
    id: "Q08",
    question:
      "Entre le Mac et la sentinelle, qui a le droit de contacter l'autre, et qu'est-ce qui l'impose ?",
    source: "docs/adr/0002-cerveau-local-sentinelle.md",
    points: [/jamais/i, /ACL|Tailscale/i],
  },
  {
    id: "Q09",
    question:
      "Qu'est-ce qui empêche, dans la base, qu'un événement du journal soit modifié ou supprimé ?",
    source: "docs/adr/0008-journal-et-etats.md",
    points: [/d[ée]clencheur|trigger/i],
  },
  {
    id: "Q10",
    question:
      "Comment le destinataire d'une réponse rédigée par Iris est-il choisi, et que voit-on à la validation si le brouillon ajoute un lien absent du fil ?",
    source: "docs/adr/0005-injection-par-les-mails.md",
    points: [/exp[ée]diteur/i, /rouge/i],
  },
  {
    id: "Q11",
    question:
      "Combien de mails fictifs le jeu de test prévoit-il, et quel genre de serveur de mail factice sert aux tests automatiques ?",
    source: "docs/adr/0010-tests-et-jeux-de-mails.md",
    points: [/\b150\b|cent cinquante/i, /GreenMail/i],
  },
  {
    id: "Q12",
    question:
      "Pour répondre à une question, combien d'appels d'outils et combien de caractères lus le CTO a-t-il au plus ?",
    source: "docs/adr/0021-outils-de-lecture-du-cto.md",
    points: [/\b6\b|six/i, /150\s?000|150\s?k/i],
  },
  {
    id: "Q13",
    question: "À quels en-têtes Iris reconnaît-elle un mail envoyé en nombre ?",
    source: "docs/adr/0029-courrier-de-masse.md",
    points: [/List-Unsubscribe/i, /List-Id/i, /Precedence/i],
  },
  {
    id: "Q14",
    question: "Quelle longueur de contexte le serveur Ollama est-il réglé à charger ?",
    source: "docs/adr/0028-ollama-sert-le-modele-local.md",
    points: [/262\s?144/],
  },
  {
    id: "Q15",
    question:
      "Combien de temps une carte du tableau de prospection est-elle gardée, et à partir de quand ce délai court-il ?",
    source: "docs/adr/0032-agent-prospection.md",
    points: [/\b60\s*jours|soixante jours/i, /d[ée]plac/i],
  },
];

export interface Scored {
  readonly id: string;
  readonly points: number;
  readonly of: number;
  readonly right: boolean;
}

export function score(q: DocsQuestion, answer: string): Scored {
  const points = q.points.filter((p) => p.test(answer)).length;
  return { id: q.id, points, of: q.points.length, right: points === q.points.length };
}
