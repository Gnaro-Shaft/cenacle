// No path to sending without my acceptance, after the undo delay, for a mail
// that still waits for my answer — and never twice. Failures are said, never
// retried; the journal holds ids, never the text.
import type { FollowedMail, MyMail } from "@cenacle/core";
import type { BuiltReply, ReplyContext } from "@cenacle/mail";
import { createProposals } from "@cenacle/mail";
import { memoryJournal, memoryProposalStore } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { type ExecutorDeps, executeDue, MAX_SENDS_PER_DAY } from "./execute.ts";

const T0 = new Date("2026-10-05T10:00:00+02:00");
const AFTER = new Date(T0.getTime() + 120_000);
const K = (c: string) => c.repeat(64);
const MAIL: FollowedMail = {
  category: "clients_prospects",
  noFollowUp: false,
  senderKey: K("a"),
  messageKey: K("b"),
  receivedAt: "2026-10-01T09:00:00+02:00",
};
const CONTEXT: ReplyContext = {
  uid: 1,
  to: "claire@client.example",
  replyToElsewhere: false,
  subject: "Point",
  messageId: "<m1@client.example>",
  references: [],
};
const SECRET = "Bonjour Claire, votre TJM est de 650 €";

function world(
  opts: { sent?: MyMail[]; mail?: FollowedMail | null; context?: ReplyContext | undefined } = {},
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
    await store.accept(p.id, T0);
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

describe("the executor sends only what I accepted, after the delay", () => {
  it("sends once, then files the copy in Sent", async () => {
    const w = world();
    const id = await w.accepted();
    const r = await executeDue(w.deps);
    expect(r.sent).toEqual([id]);
    expect(w.outbox).toHaveLength(1);
    expect(w.copies).toHaveLength(1);
    expect((await w.store.get(id))?.status).toBe("sent");
    await executeDue(w.deps);
    expect(w.outbox).toHaveLength(1);
  });

  it("nothing before the undo delay is over", async () => {
    const w = world();
    await w.accepted();
    w.at(new Date(AFTER.getTime() - 1));
    expect((await executeDue(w.deps)).sent).toEqual([]);
    expect(w.outbox).toEqual([]);
  });

  it("nothing pending, refused or cancelled is ever sent", async () => {
    const w = world();
    await w.store.create({
      id: "p-pending",
      mailUidValidity: "9",
      mailUid: 50,
      trame: null,
      draft: "x",
    });
    const refused = await w.store.create({
      id: "p-ref",
      mailUidValidity: "9",
      mailUid: 51,
      trame: null,
      draft: "x",
    });
    await w.store.refuse(refused.id, T0);
    const c = await w.accepted();
    await w.store.cancel(c, T0);
    await executeDue(w.deps);
    expect(w.outbox).toEqual([]);
  });
});

describe("the last-moment checks", () => {
  it("I answered meanwhile (seen in Sent, fresh): lapsed, not sent", async () => {
    const w = world({
      sent: [{ sentAt: "2026-10-05T09:00:00+02:00", recipientKeys: [K("a")], threadKeys: [] }],
    });
    const id = await w.accepted();
    const r = await executeDue(w.deps);
    expect(r.lapsed).toEqual([{ id, reason: "answered" }]);
    expect(w.outbox).toEqual([]);
    expect(w.journal.events.map((e) => e.type)).toContain("send.lapsed");
  });

  it.each([
    ["the mail is gone from Iris's memory", { mail: null }, "gone"],
    ["the mail is gone from the server", { context: undefined }, "gone"],
    ["the sender cannot be read", { context: { ...CONTEXT, to: null } }, "no_recipient"],
  ])("%s: lapsed, not sent", async (_label, opts, reason) => {
    const w = world(opts as Parameters<typeof world>[0]);
    const id = await w.accepted();
    expect((await executeDue(w.deps)).lapsed).toEqual([{ id, reason }]);
    expect(w.outbox).toEqual([]);
  });
});

describe("failures: said, never retried, never duplicated", () => {
  it("SMTP down: failed, shown, not retried when it comes back", async () => {
    const w = world();
    const id = await w.accepted();
    w.smtp(false);
    expect((await executeDue(w.deps)).failed).toEqual([id]);
    w.smtp(true);
    await executeDue(w.deps);
    expect(w.outbox).toEqual([]);
    expect((await w.store.get(id))?.status).toBe("failed");
    expect((await w.store.open()).map((p) => p.id)).toContain(id);
  });

  it("the copy in Sent fails: the mail is sent, the failure is journaled", async () => {
    const w = world();
    const id = await w.accepted();
    w.imap(false);
    expect((await executeDue(w.deps)).sent).toEqual([id]);
    expect(w.journal.events.map((e) => e.type)).toContain("send.copy_failed");
  });

  it("two executors at once: each mail is sent once", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await w.accepted();
    await Promise.all([executeDue(w.deps), executeDue(w.deps)]);
    expect(w.outbox).toHaveLength(5);
  });

  it(`at most ${MAX_SENDS_PER_DAY} attempts a day; the rest waits`, async () => {
    const w = world();
    for (let i = 0; i < MAX_SENDS_PER_DAY + 3; i++) await w.accepted();
    const r = await executeDue(w.deps);
    expect(r.limited).toBe(true);
    expect(w.outbox).toHaveLength(MAX_SENDS_PER_DAY);
    expect(await w.store.dueForSending(AFTER)).toHaveLength(3);
  });

  it("the journal never holds the text, the address or the error message", async () => {
    const w = world();
    await w.accepted();
    await w.accepted();
    await executeDue(w.deps);
    w.smtp(false);
    await w.accepted();
    await executeDue(w.deps);
    const logged = JSON.stringify(w.journal.events.map((e) => [e.type, e.payload]));
    for (const secret of ["Claire", "650", "client.example", "ECONNREFUSED", "3025"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
