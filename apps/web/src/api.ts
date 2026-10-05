/** Calls to the proposals API, with the token of this run of the server. */

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
