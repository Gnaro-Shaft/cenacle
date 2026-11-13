// The server buttons' test world (J6f1b, ADR-0036): the bot's dependencies in
// memory — a store that confirms once, within its delay, signing first as the
// real one does — shared by the server buttons' adversarial tests.
import { ConfirmationFieldError } from "@cenacle/core";
import type { ConfirmOutcome, StoredFinding, StoredServerAction } from "@cenacle/journal";
import type { TelegramCallback } from "./api.ts";
import type { SecuriteBotDeps } from "./securite-bot.ts";

export const OWNER = 4242;
// Fake tokens, built by pieces (test values, not secrets).
export const TOKEN = ["01234567", "89abcdef"].join("");
export const OP = ["fedcba98", "76543210"].join("");
export const NOW = new Date("2026-10-11T10:00:00Z");

export const finding = (id: number, type: string, target = "v10-essai"): StoredFinding =>
  ({
    id,
    type,
    target,
    occurrence: "-",
    status: "ouvert",
    severity: "moyen",
    title: "x",
    params: {},
  }) as StoredFinding;

/** A signature's shape (86 base64url characters); what it signs is tested where it is made. */
export const SIG = "s".repeat(86);
/** The row the store holds for request 7, as it reads once confirmed. */
export const ROW: StoredServerAction = {
  id: 7,
  findingId: 41,
  planId: null,
  host: "v10-essai",
  action: "services",
  state: "confirmee",
  requestedAt: NOW,
  confirmedAt: NOW,
  finishedAt: null,
  exitCode: null,
  refusal: null,
  verified: null,
  beforeCount: null,
  afterCount: null,
  confirmSig: null,
};

export function world(
  opts: {
    active?: boolean;
    findings?: readonly StoredFinding[];
    pending?: boolean;
    noKey?: boolean;
    unsignable?: boolean;
  } = {},
) {
  const calls: string[] = [];
  /** What the store was handed as my confirmation's signature. */
  const signatures: (string | null)[] = [];
  const requests: { findingId: number; host: string; at: Date }[] = [];
  let until = NOW.getTime() + 120_000;
  let confirmed = false;
  const deps: SecuriteBotDeps = {
    allowedChatId: OWNER,
    api: {
      sendMessage: async (_c, text) => {
        calls.push(`send ${text}`);
      },
      sendWithButtons: async (_c, text, rows) => {
        calls.push(
          `buttons ${text} ${rows
            .flat()
            .map((b) => b.callback_data)
            .join(",")}`,
        );
        return 1;
      },
      askReply: async () => 1,
      answerCallback: async (_id, text) => {
        calls.push(`answer ${text}`);
      },
      editButtons: async (_c, _m, rows) => {
        calls.push(`edit ${rows.length}`);
      },
    },
    store: { open: async () => [...(opts.findings ?? [finding(41, "serveur_services")])] },
    decisions: {
      tokens: async (ids) => new Map(ids.map((id) => [id, TOKEN])),
      check: async (_id, token) => (token === TOKEN ? "done" : "stale"),
      decide: async () => "done",
      askReason: async () => undefined,
      giveReason: async () => "unknown",
      isAsking: async () => false,
      requestPr: async () => "stale",
      requestFix: async () => "stale",
      purge: async () => 0,
    },
    serverActions: {
      request: async (findingId, host, _action, now) => {
        if (opts.pending === true) return null;
        requests.push({ findingId, host, at: now });
        return { id: 7, token: OP };
      },
      confirm: async (id, token, now, sign): Promise<ConfirmOutcome> => {
        if (id !== 7 || token !== OP) return "stale";
        if (confirmed) return "already";
        if (now.getTime() > until) return "expired";
        // As the real store: signed first — a signer that throws confirms nothing.
        signatures.push(sign === undefined ? null : sign(ROW));
        confirmed = true;
        return "done";
      },
    },
    signAction:
      opts.noKey === true
        ? null
        : () => {
            if (opts.unsignable === true) throw new ConfirmationFieldError("not a plain name");
            return SIG;
          },
    signPlan: null,
    serversActive: () => opts.active ?? true,
    journal: {
      append: async (e) => {
        calls.push(`journal ${JSON.stringify(e.payload)}`);
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
  };
  return {
    deps,
    calls,
    requests,
    signatures,
    late: () => {
      until = NOW.getTime() - 1;
    },
  };
}
export const tap = (data: string, from = OWNER): TelegramCallback => ({
  id: "cb1",
  from: { id: from },
  data,
  message: {
    message_id: 10,
    chat: { id: OWNER, type: "private" },
    reply_markup: { inline_keyboard: [] },
  },
});
