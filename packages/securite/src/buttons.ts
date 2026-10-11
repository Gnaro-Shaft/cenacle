/**
 * The buttons under a finding (J6b): ✅ I'm on it, ☑ keep the risk, ❌ refuse
 * — and 🔧 prepare the pull request (J6c), only under a finding the closed
 * catalogue can fix without privilege.
 * A button's data names the finding, the action and the finding's random
 * token — at most 64 bytes, Telegram's limit — and is read strictly: anything
 * else is ignored. The words the bot answers with are fixed here.
 */

export type ButtonAction = "take" | "keep" | "refuse" | "fix";

export interface Button {
  readonly text: string;
  readonly data: string;
}

export interface Pressed {
  readonly id: number;
  readonly action: ButtonAction;
  readonly token: string;
}

const CODE: Readonly<Record<ButtonAction, string>> = {
  take: "t",
  keep: "k",
  refuse: "r",
  fix: "f",
};
const ACTION: Readonly<Record<string, ButtonAction>> = {
  t: "take",
  k: "keep",
  r: "refuse",
  f: "fix",
};
const DATA = /^s:(\d{1,12}):([tkrf]):([0-9a-f]{16})$/;
export const MAX_BUTTON_DATA = 64;
/** At most this many findings get buttons in one message. */
export const MAX_BUTTON_ROWS = 10;

/**
 * One row per finding still to fix (and with a token): three buttons, and
 * 🔧 when the finding can be fixed by a prepared pull request.
 */
export function keyboard(
  findings: readonly { id: number; token: string; fixable?: boolean }[],
): Button[][] {
  return findings
    .slice(0, MAX_BUTTON_ROWS)
    .map(({ id, token, fixable }) =>
      (
        [
          ["take", `✅ n°${id} je m'en occupe`],
          ["keep", `☑ n°${id} risque`],
          ["refuse", `❌ n°${id} refuser`],
          ...(fixable === true ? ([["fix", `🔧 n°${id} prépare la PR`]] as const) : []),
        ] as const
      ).map(([action, text]) => ({ text, data: `s:${id}:${CODE[action]}:${token}` })),
    );
}

export function parsePressed(data: unknown): Pressed | null {
  if (typeof data !== "string" || data.length > MAX_BUTTON_DATA) return null;
  const m = DATA.exec(data);
  if (m === null) return null;
  const id = Number(m[1]);
  const action = ACTION[m[2] ?? ""];
  if (!Number.isSafeInteger(id) || id <= 0 || action === undefined) return null;
  return { id, action, token: m[3] ?? "" };
}

/** Under a pull request the agent prepared, CI green (J6d): ✅ merge, ❌ close. */
export type PrAction = "merge" | "close";
const PR_DATA = /^p:(\d{1,12}):([mc]):([0-9a-f]{16})$/;

export function prKeyboard(id: number, token: string): Button[][] {
  return [
    [
      { text: `✅ Fusionner (constat n°${id})`, data: `p:${id}:m:${token}` },
      { text: "❌ Fermer", data: `p:${id}:c:${token}` },
    ],
  ];
}

export function parsePrPressed(
  data: unknown,
): { id: number; action: PrAction; token: string } | null {
  if (typeof data !== "string" || data.length > MAX_BUTTON_DATA) return null;
  const m = PR_DATA.exec(data);
  if (m === null) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, action: m[2] === "m" ? "merge" : "close", token: m[3] ?? "" };
}

/** The rows left once a finding is decided: its own row goes, the others stay. */
export function withoutFinding(rows: readonly Button[][], id: number): Button[][] {
  return rows.filter((row) => !row.some((b) => parsePressed(b.data)?.id === id));
}

export const ANSWER = {
  take: (id: number) => `✅ Constat n°${id} pris en charge : je te dirai quand il sera corrigé.`,
  treated: (id: number) =>
    `✅ Bulletin n°${id} noté comme traité : il se tait, et reviendra dans 90 jours s'il est toujours publié.`,
  refuse: (id: number) =>
    `❌ Constat n°${id} refusé : il se tait pour cette occurrence, et reviendra dans 30 jours s'il persiste.`,
  askReason: (id: number) =>
    `☑ Pourquoi garder le risque du constat n°${id} ? Réponds à ce message avec la raison (3 à 200 caractères), dans les 10 minutes. /annuler pour abandonner.`,
  fix: (id: number) =>
    `🔧 Demande notée pour le constat n°${id} : la prochaine ronde (15 min au plus) prépare la PR. Elle ne sera jamais fusionnée sans toi.`,
  notFixable: "🔧 Ce constat ne se corrige pas par une PR : rien n'a changé.",
  merge: (id: number) =>
    `✅ Fusion demandée (constat n°${id}) : la prochaine ronde la fait, seulement si rien n'a bougé depuis la CI.`,
  close: (id: number) =>
    `❌ Fermeture demandée (constat n°${id}) : la prochaine ronde ferme la PR.`,
  notReady: "Cette PR n'attend pas de décision (CI pas encore verte, ou déjà décidée).",
  kept: "☑ Risque gardé : le constat se tait jusqu'à une nouvelle occurrence, et sera redemandé dans 90 jours.",
  stale:
    "Ce bouton n'est plus valable (message ancien ou déjà utilisé) : /constats pour les boutons à jour.",
  already: "Ce constat est déjà décidé ou résolu.",
  expired: "Délai dépassé : rien n'a changé. Rappuie sur ☑ pour recommencer.",
  unknown: "Je n'attendais pas de raison ici : rien n'a changé.",
  badReason:
    "La raison doit faire 3 à 200 caractères : rien n'a changé. Réponds encore à ma question.",
  cancelled: "Abandonné : rien n'a changé.",
} as const;
