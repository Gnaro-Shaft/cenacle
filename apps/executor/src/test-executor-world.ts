// The executor's test world (shared by its test files): a memory store and
// journal, a mailbox that answers what it is told, an SMTP that can go down.
// Fictional values only. Tests only.
import type { FollowedMail, MyMail } from "@cenacle/core";
import type { BuiltReply, ReplyContext } from "@cenacle/mail";
import { createProposals } from "@cenacle/mail";
import {
  memoryJournal,
  memoryProposalStore,
  signedNow,
  TEST_KEYS,
} from "@cenacle/mail/test-helpers";
import type { ExecutorDeps } from "./execute.ts";

export const TEST_MAX_PER_DAY = 20;

export const T0 = new Date("2026-10-05T10:00:00+02:00");
export const AFTER = new Date(T0.getTime() + 120_000);
export const K = (c: string) => c.repeat(64);
export const MAIL: FollowedMail = {
  category: "clients_prospects",
  noFollowUp: false,
  senderAuthenticated: true,
  senderKey: K("a"),
  messageKey: K("b"),
  receivedAt: "2026-10-01T09:00:00+02:00",
};
export const CONTEXT: ReplyContext = {
  uid: 1,
  to: "claire@client.example",
  replyToElsewhere: false,
  subject: "Point",
  messageId: "<m1@client.example>",
  references: [],
};
export const SECRET = "Bonjour Claire, votre TJM est de 650 €";

export function world(
  opts: {
    sent?: MyMail[];
    mail?: FollowedMail | null;
    context?: ReplyContext | undefined;
    maxPerDay?: number;
    undoMs?: number;
    authenticated?: boolean;
  } = {},
) {
  const store = memoryProposalStore();
  const journal = memoryJournal();
  const outbox: BuiltReply[] = [];
  const copies: BuiltReply[] = [];
  let now = AFTER;
  let smtpUp = true;
  let copyUp = true;
  const deps: ExecutorDeps = {
    store,
    proposals: createProposals(store, journal),
    journal,
    now: () => now,
    mailOf: async () => (opts.mail === undefined ? MAIL : opts.mail),
    freshSent: async () => opts.sent ?? [],
    context: async () => ("context" in opts ? opts.context : CONTEXT),
    build: async (context, text) => ({ to: context.to ?? "", raw: Buffer.from(text) }),
    send: async (reply) => {
      if (!smtpUp) throw new Error("ECONNREFUSED 127.0.0.1:3025");
      outbox.push(reply);
    },
    copy: async (reply) => {
      if (!copyUp) throw new Error("IMAP down");
      copies.push(reply);
    },
    verify: TEST_KEYS.verify,
    maxPerDay: opts.maxPerDay ?? TEST_MAX_PER_DAY,
    undoMs: opts.undoMs ?? 120_000,
    authenticated: async () => opts.authenticated ?? true,
  };
  let n = 0;
  const accepted = async (draft = SECRET) => {
    n++;
    const p = await store.create({
      id: `p-${n}`,
      mailUidValidity: "9",
      mailUid: n,
      trame: null,
      draft,
    });
    await store.accept(p.id, T0, await signedNow(store, p.id, T0));
    return p.id;
  };
  return {
    deps,
    store,
    journal,
    outbox,
    copies,
    accepted,
    at: (d: Date) => {
      now = d;
    },
    smtp: (up: boolean) => {
      smtpUp = up;
    },
    imap: (up: boolean) => {
      copyUp = up;
    },
  };
}
