/** Calls to the API (proposals, the CTO, the board), with the token of this run of the server. */

export interface ProposalView {
  readonly id: string;
  readonly status: "pending" | "accepted" | "sending" | "failed";
  readonly trame: string | null;
  readonly draft: string;
  readonly createdAt: string;
  readonly sendAfter: string | null;
  readonly mail: {
    readonly subject: string;
    readonly fromName: string;
    readonly to: string | null;
    readonly replyToElsewhere: boolean;
  } | null;
  readonly toComplete: readonly string[];
  readonly unsupported: readonly string[];
  /** Where an accepted reply goes (M3). */
  readonly delivery: "test" | "my_list" | "real";
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new ApiError(response.status, body.error ?? `erreur ${response.status}`);
  return body;
}

export const listProposals = async (token: string) =>
  (await call<{ proposals: ProposalView[] }>(token, "/api/proposals")).proposals;

export const saveDraft = (token: string, id: string, draft: string) =>
  call(token, `/api/proposals/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    body: JSON.stringify({ draft }),
  });

export const act = (token: string, id: string, action: "accept" | "refuse" | "cancel") =>
  call(token, `/api/proposals/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });

/** The CTO's checked answer (ADR-0020). */
export interface CtoReplyView {
  readonly text: string;
  readonly summary: string;
  readonly cut: boolean;
  readonly seconds: number;
}

export const askCto = async (token: string, question: string) =>
  (
    await call<{ reply: CtoReplyView }>(token, "/api/cto", {
      method: "POST",
      body: JSON.stringify({ question }),
    })
  ).reply;

/** A card of the board of missions (ADR-0032), as the server shows it. */
export interface CardView {
  readonly id: number;
  readonly source: "mail" | "me";
  readonly platform: string | null;
  readonly title: string;
  readonly company: string | null;
  readonly intermediary: string;
  readonly stack: readonly string[];
  readonly rate: readonly [number, number] | null;
  readonly remote: string;
  readonly place: string | null;
  readonly link: string | null;
  readonly note: string | null;
  readonly column: string;
  readonly reason: string | null;
  readonly decidedBy: string;
  readonly toCheck: boolean;
  readonly createdAt: string;
  readonly movedAt: string | null;
  /** In an agent's column: the card in « applied » or beyond for the same mission. */
  readonly applied: number | null;
}

/** Mails I must read myself: set aside by the floor, or a confirmation unread (counts only). */
export interface ToRead {
  readonly floor: number;
  readonly applications: number;
}

export const listCards = (token: string) =>
  call<{ cards: CardView[]; toRead: ToRead }>(token, "/api/prospection/cartes");

export const addCard = async (token: string, fields: Record<string, unknown>) =>
  (
    await call<{ card: CardView }>(token, "/api/prospection/cartes", {
      method: "POST",
      body: JSON.stringify(fields),
    })
  ).card;

export const moveCard = (token: string, id: number, colonne: string) =>
  call(token, `/api/prospection/cartes/${encodeURIComponent(String(id))}/deplacer`, {
    method: "POST",
    body: JSON.stringify({ colonne }),
  });
