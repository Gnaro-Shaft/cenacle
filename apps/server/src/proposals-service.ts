/**
 * What the validation page sees and does (phase 4, B3).
 *
 * The recipient is read again from the server each time (the sender of the
 * mail, never the Reply-To); it is never stored and the page cannot change it.
 * Red flags: slots left for me, facts absent from the thread, a Reply-To
 * elsewhere. Accepting needs a readable recipient and no slot left.
 * Accepting is signed here (ADR-0013): the executor sends nothing else.
 * Nothing is sent here: the executor (B4) is the only one that sends.
 */
import { checkDraft, type MailForModel } from "@cenacle/core";
import {
  type Proposal,
  ProposalError,
  type ProposalStore,
  type SignedAcceptance,
} from "@cenacle/journal";
import type { Proposals, ReplyTarget, Trames } from "@cenacle/mail";

/** What the page shows: waiting for me, accepted, being sent, and failed sends. */
export type ShownStatus = "pending" | "accepted" | "sending" | "failed";
const SHOWN: readonly string[] = ["pending", "accepted", "sending", "failed"];

export interface ProposalView {
  readonly id: string;
  readonly status: ShownStatus;
  readonly trame: string | null;
  readonly draft: string;
  readonly createdAt: string;
  /** End of the undo delay, when accepted. */
  readonly sendAfter: string | null;
  /** Null when the mail is no longer on the server. */
  readonly mail: {
    readonly subject: string;
    readonly fromName: string;
    /** The only possible recipient; null when the sender cannot be read safely. */
    readonly to: string | null;
    readonly replyToElsewhere: boolean;
  } | null;
  readonly toComplete: readonly string[];
  /** Facts of the draft absent from the thread and from my templates. */
  readonly unsupported: readonly string[];
  /** Where an accepted reply goes: test domains, my closed list, or the real correspondent (M3). */
  readonly delivery: Delivery;
}

export type Delivery = "test" | "my_list" | "real";

export interface ProposalsService {
  list(): Promise<ProposalView[]>;
  /** My text, as sent by the page: checked here (type, length, characters). */
  edit(id: string, draft: unknown): Promise<void>;
  accept(id: string): Promise<void>;
  refuse(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface ServiceDeps {
  readonly store: ProposalStore;
  readonly proposals: Proposals;
  /** Current UIDVALIDITY of the inbox as Iris knows it; null when she knows no mail. */
  readonly uidValidity: () => Promise<string | null>;
  readonly readMails: (uids: readonly number[], uidValidity: string) => Promise<MailForModel[]>;
  readonly readTargets: (
    uids: readonly number[],
    uidValidity: string,
  ) => Promise<Map<number, ReplyTarget>>;
  readonly trames: Trames;
  readonly now: () => Date;
  /** Signs my acceptance of this proposal's current text (the page's private key, ADR-0013). */
  readonly sign: (p: Proposal, now: Date) => SignedAcceptance;
  /** The box's undo delay: 10 min on a real box (M3), 2 min on a test box. */
  readonly undoMs: number;
  /** Where the box sends (opening.ts): shown on every proposal. */
  readonly sending: "none" | "test-domains" | "closed" | "correspondents";
}

const SLOT_LEFT = /\{([a-z_]+) \?\}/g;
export const MAX_DRAFT = 5000;

/** My edit: plain text, bounded, no control character but line breaks and tabs. */
export function cleanDraft(draft: unknown): string {
  if (typeof draft !== "string") throw new ProposalError("the draft must be a text");
  const text = draft.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0 || text.length > MAX_DRAFT) {
    throw new ProposalError(`the draft must hold 1 to ${MAX_DRAFT} characters`);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) {
    throw new ProposalError("the draft holds a control character");
  }
  return text;
}

export function createProposalsService(deps: ServiceDeps): ProposalsService {
  const templateWords = (trame: string | null) => [
    ...(trame === null ? [] : [deps.trames.trames.get(trame)?.texte ?? ""]),
    deps.trames.signature,
  ];

  async function targetOf(p: Proposal): Promise<ReplyTarget | undefined> {
    const validity = await deps.uidValidity();
    if (validity !== p.mailUidValidity) return undefined;
    return (await deps.readTargets([p.mailUid], validity)).get(p.mailUid);
  }

  return {
    async list() {
      const delivery: Delivery =
        deps.sending === "correspondents" ? "real" : deps.sending === "closed" ? "my_list" : "test";
      const open = (await deps.store.open()).filter(
        (p): p is Proposal & { status: ShownStatus; draft: string } =>
          SHOWN.includes(p.status) && p.draft !== null,
      );
      const validity = await deps.uidValidity();
      const here = open.filter((p) => p.mailUidValidity === validity).map((p) => p.mailUid);
      const mails = new Map<number, MailForModel>();
      let targets = new Map<number, ReplyTarget>();
      if (validity !== null && here.length > 0) {
        for (const m of await deps.readMails(here, validity)) mails.set(m.uid, m);
        targets = await deps.readTargets(here, validity);
      }
      return open.map((p) => {
        const mail = p.mailUidValidity === validity ? mails.get(p.mailUid) : undefined;
        const target = p.mailUidValidity === validity ? targets.get(p.mailUid) : undefined;
        const sources = [
          ...(mail === undefined ? [] : [mail.subject, mail.text]),
          ...templateWords(p.trame),
        ];
        return {
          id: p.id,
          status: p.status,
          trame: p.trame,
          draft: p.draft,
          createdAt: p.createdAt.toISOString(),
          sendAfter: p.sendAfter?.toISOString() ?? null,
          mail:
            mail === undefined
              ? null
              : {
                  subject: mail.subject,
                  fromName: mail.fromName,
                  to: target?.to ?? null,
                  replyToElsewhere: target?.replyToElsewhere ?? false,
                },
          toComplete: [...p.draft.matchAll(SLOT_LEFT)].map((m) => m[1] ?? ""),
          unsupported: checkDraft(p.draft, sources).unsupported.map((f) => f.raw),
          delivery,
        };
      });
    },

    async edit(id, draft) {
      await deps.store.edit(id, cleanDraft(draft));
    },

    async accept(id) {
      const p = await deps.store.get(id);
      if (p === null) throw new ProposalError(`proposal ${id} does not exist`);
      const target = await targetOf(p);
      if (target === undefined) {
        throw new ProposalError(`proposal ${id}: the mail is no longer on the server`);
      }
      if (target.to === null) {
        throw new ProposalError(`proposal ${id}: the sender's address cannot be read safely`);
      }
      const now = deps.now();
      // Signed on the text read just now; the database accepts only if it is still that text.
      await deps.proposals.accept(id, now, deps.sign(p, now), deps.undoMs);
    },

    async refuse(id) {
      await deps.proposals.refuse(id, deps.now());
    },

    async cancel(id) {
      await deps.proposals.cancel(id, deps.now());
    },
  };
}
