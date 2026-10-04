/**
 * One world of the draft bench (phase 4, B5): the real proposals table in
 * PostgreSQL, the real page API (guard + service), the real drafting and the
 * real executor. Only three things are stood in for:
 * - the mail server, by the fictional mailbox (fixtures/mails.json);
 * - the model, by a hostile stand-in given by each scenario;
 * - SMTP, by an outbox that records every reply handed to it.
 * The clock is mine: the undo delay and the days pass when I say so.
 */
import { createHash } from "node:crypto";
import type { ThreadSlot, TrameVote } from "@cenacle/brain";
import {
  type FixtureMessage,
  type FollowedMail,
  generateAcceptanceKeys,
  type MailForModel,
  type MyMail,
  PRIVATE_KEY_VAR,
  PUBLIC_KEY_VAR,
  privateKeyFromEnv,
  publicKeyFromEnv,
} from "@cenacle/core";
import { type ExecutorDeps, executeDue, type RoundResult } from "@cenacle/executor/execute";
import { type DraftOutcome, draftFollowUp } from "@cenacle/iris/draft";
import {
  createJournal,
  createProposalStore,
  type Proposal,
  type ProposalStore,
} from "@cenacle/journal";
import {
  buildReply,
  createProposals,
  EXAMPLE_TRAMES_PATH,
  fixtureForModel,
  isAcceptedByPage,
  loadTrames,
  type Proposals,
  type ReplyContext,
  type ReplyTarget,
  replyTargetOf,
  signProposal,
  type Trames,
} from "@cenacle/mail";
import { createApp } from "@cenacle/server/app";
import { defaultGuardConfig, newToken } from "@cenacle/server/guard";
import { createProposalsService } from "@cenacle/server/proposals-service";
/** The database connection, as the stores take it. */
export type Sql = Parameters<typeof createProposalStore>[0];

/** Who the replies are from: a reserved test domain, as in phase 4. */
const FROM = "iris-bench@cenacle.test";
/** Long before any clock of the bench: every mail is due. */
const RECEIVED = "2026-09-01T09:00:00+02:00";
export const TRAMES: Trames = loadTrames({
  local: "/nonexistent.toml",
  example: EXAMPLE_TRAMES_PATH,
});

const key = (v: string) => createHash("sha256").update(v).digest("hex");

/** What may be swapped to prove the bench turns red (its own adversarial test). */
export interface Mutations {
  readonly draft?: typeof draftFollowUp;
  readonly tamper?: (deps: ExecutorDeps, sql: Sql) => ExecutorDeps;
  readonly newToken?: () => string;
}

export interface Outgoing {
  /** When SMTP got it (the bench's clock). */
  readonly at: Date;
  readonly to: string;
  readonly uidValidity: string;
  readonly uid: number;
  readonly text: string;
}

export interface HostileModel {
  readonly vote: (mail: MailForModel) => TrameVote;
  readonly copy: (
    mail: MailForModel,
    slots: readonly ThreadSlot[],
  ) => Partial<Record<ThreadSlot, string>>;
}

export const votedFor = (choice: string | null): TrameVote => ({
  choice,
  votes: choice === null ? {} : { [choice]: 6 },
  rounds: 6,
  needed: 5,
});

/** The fictional mailbox standing in for the IMAP server. */
export class FakeMailbox {
  uidValidity: string;
  readonly mails = new Map<number, FixtureMessage>();
  readonly sent: MyMail[] = [];
  /** A Reply-To header, per uid (the diversion trap). */
  readonly replyTo = new Map<number, string>();

  constructor(uidValidity: string, mails: readonly FixtureMessage[]) {
    this.uidValidity = uidValidity;
    mails.forEach((m, i) => {
      this.mails.set(i + 1, m);
    });
  }

  private here(uid: number, validity: string): FixtureMessage | undefined {
    return validity === this.uidValidity ? this.mails.get(uid) : undefined;
  }
  forModel(uid: number): MailForModel {
    const m = this.mails.get(uid);
    if (m === undefined) throw new Error(`no mail ${uid}`);
    return fixtureForModel(uid, m);
  }
  target(uid: number, validity: string): ReplyTarget | undefined {
    const m = this.here(uid, validity);
    if (m === undefined) return undefined;
    // The real reading of From and Reply-To, as the postman does it.
    const replyTo = this.replyTo.get(uid);
    return replyTargetOf(
      uid,
      [{ address: m.from.address }],
      replyTo === undefined ? [] : [{ address: replyTo }],
    );
  }
  context(uid: number, validity: string): ReplyContext | undefined {
    const target = this.target(uid, validity);
    const m = this.here(uid, validity);
    if (target === undefined || m === undefined) return undefined;
    return {
      ...target,
      subject: m.subject,
      messageId: `<${m.id}@fixtures.example>`,
      references: [],
    };
  }
  followed(uid: number, validity: string): FollowedMail | null {
    const m = this.here(uid, validity);
    if (m === undefined) return null;
    return {
      category: "clients_prospects",
      noFollowUp: false,
      senderKey: key(m.from.address),
      messageKey: key(m.id),
      receivedAt: RECEIVED,
    };
  }
  /** I answer this mail myself, from my mail client. */
  answer(uid: number, at: Date): void {
    const m = this.mails.get(uid);
    if (m === undefined) return;
    this.sent.push({ sentAt: at.toISOString(), recipientKeys: [], threadKeys: [key(m.id)] });
  }
}

export interface Page {
  readonly token: string;
  readonly app: ReturnType<typeof createApp>;
}

export interface World {
  /** The application role's connection: what any program holding it could do by hand. */
  readonly sql: Sql;
  readonly store: ProposalStore;
  readonly proposals: Proposals;
  readonly mailbox: FakeMailbox;
  readonly outbox: Outgoing[];
  /** Proposals the page accepted (HTTP 200), and when. */
  readonly acceptedByPage: Map<string, Date>;
  /** The proposal of a mail, whatever became of it; null if it never had one. */
  proposalFor(uidValidity: string, uid: number): Promise<Proposal | null>;
  /** How many proposals of this world are being sent or sent (failed ones excluded). */
  sendingOrSent(): Promise<number>;
  now(): Date;
  advance(ms: number): void;
  /** Iris drafts for one mail, with the hostile model. */
  draft(uid: number, model: HostileModel): Promise<DraftOutcome>;
  /** One round of the executor. `pause` runs just before its claim. */
  execute(pause?: () => Promise<void>): Promise<RoundResult>;
  /** A start of the API server: a new token each time. */
  startPage(): Page;
  /** The page acts, with its own headers unless others are given. Returns the HTTP status. */
  act(
    page: Page,
    id: string,
    action: string,
    headers?: Record<string, string>,
    body?: string,
  ): Promise<number>;
}

export const pageHeaders = (token: string): Record<string, string> => ({
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

let ids = 0;

export function createWorld(
  sql: Sql,
  opts: {
    readonly uidValidity: string;
    readonly start: Date;
    readonly mails: readonly FixtureMessage[];
    readonly mutations?: Mutations | undefined;
    /** The executor's own role (B7): the only one allowed to claim and close a sending. */
    readonly executorSql: Sql;
  },
): World {
  const m = opts.mutations ?? {};
  const store = createProposalStore(sql);
  const journal = createJournal(sql);
  const proposals = createProposals(store, journal);
  const executorStore = createProposalStore(opts.executorSql);
  const executorProposals = createProposals(executorStore, createJournal(opts.executorSql));
  const mailbox = new FakeMailbox(opts.uidValidity, opts.mails);
  const outbox: Outgoing[] = [];
  const acceptedByPage = new Map<string, Date>();
  const built = new WeakMap<object, Outgoing>();
  let clock = opts.start.getTime();
  const now = () => new Date(clock);
  // The page's key pair, as npm run keys:accept makes it.
  const keys = generateAcceptanceKeys();
  const env = { [PRIVATE_KEY_VAR]: keys.privateKey, [PUBLIC_KEY_VAR]: keys.publicKey };
  const privateKey = privateKeyFromEnv(env);
  const publicKey = publicKeyFromEnv(env);

  const service = createProposalsService({
    store,
    proposals,
    uidValidity: async () => mailbox.uidValidity,
    readMails: async (uids, v) =>
      uids.filter((u) => mailbox.target(u, v) !== undefined).map((u) => mailbox.forModel(u)),
    readTargets: async (uids, v) => {
      const out = new Map<number, ReplyTarget>();
      for (const u of uids) {
        const t = mailbox.target(u, v);
        if (t !== undefined) out.set(u, t);
      }
      return out;
    },
    trames: TRAMES,
    now,
    sign: (p, at) => signProposal(privateKey, p, at),
  });

  return {
    sql,
    store,
    proposals,
    mailbox,
    outbox,
    acceptedByPage,
    async proposalFor(uidValidity, uid) {
      const [row] = await sql<{ id: string }[]>`
        select id from proposals where mail_uid_validity = ${uidValidity} and mail_uid = ${uid}`;
      return row === undefined ? null : store.get(row.id);
    },
    async sendingOrSent() {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from proposals
        where mail_uid_validity = ${opts.uidValidity} and status in ('sending', 'sent')`;
      return row?.n ?? 0;
    },
    now,
    advance(ms) {
      clock += ms;
    },
    async draft(uid, model) {
      const run = m.draft ?? draftFollowUp;
      return run(mailbox.forModel(uid), mailbox.uidValidity, {
        trames: TRAMES,
        proposals,
        vote: async (mail) => model.vote(mail),
        copySlots: async (mail, slots) => model.copy(mail, slots),
        newId: () => `bench-${process.pid}-${++ids}`,
        now,
      });
    },
    async execute(pause) {
      const real: ExecutorDeps = {
        store: executorStore,
        proposals: executorProposals,
        journal: createJournal(opts.executorSql),
        now,
        mailOf: async (p) => mailbox.followed(p.mailUid, p.mailUidValidity),
        freshSent: async () => [...mailbox.sent],
        context: async (p) => mailbox.context(p.mailUid, p.mailUidValidity),
        build: async (context, text, date) => {
          // The real builder: one recipient, on a test domain, or it throws.
          const reply = await buildReply(FROM, context, text, date);
          built.set(reply, {
            at: now(),
            to: reply.to,
            uidValidity: mailbox.uidValidity,
            uid: context.uid,
            text,
          });
          return reply;
        },
        send: async (reply) => {
          const out = built.get(reply);
          if (out === undefined) throw new Error("a reply the bench did not build");
          outbox.push(out);
        },
        copy: async () => {},
        verify: (p) => isAcceptedByPage(publicKey, p),
      };
      const deps = m.tamper === undefined ? real : m.tamper(real, opts.executorSql);
      const claim = deps.store.claim;
      return executeDue({
        ...deps,
        store: {
          ...deps.store,
          claim: async (id, at) => {
            await pause?.();
            return claim(id, at);
          },
        },
      });
    },
    startPage() {
      const token = (m.newToken ?? newToken)();
      return {
        token,
        app: createApp({
          readAfter: async () => [],
          guard: defaultGuardConfig(token),
          proposals: service,
        }),
      };
    },
    async act(page, id, action, headers, body = "{}") {
      const res = await page.app.request(`/api/proposals/${id}/${action}`, {
        method: action === "draft" ? "PUT" : "POST",
        headers: headers ?? pageHeaders(page.token),
        body,
      });
      if (action === "accept" && res.status === 200) acceptedByPage.set(id, now());
      return res.status;
    },
  };
}
