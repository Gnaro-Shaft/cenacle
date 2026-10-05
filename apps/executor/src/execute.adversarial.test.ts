// No path to sending without my acceptance, after the undo delay, for a mail
// that still waits for my answer — and never twice. Failures are said, never
// retried; the journal holds ids, never the text.
import type { FollowedMail, MyMail } from "@cenacle/core";
import type { BuiltReply, ReplyContext } from "@cenacle/mail";
import { createProposals } from "@cenacle/mail";
import {
  memoryJournal,
  memoryProposalStore,
  signedNow,
  TEST_KEYS,
  testAcceptanceKeys,
} from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { type ExecutorDeps, executeDue } from "./execute.ts";

const TEST_MAX_PER_DAY = 20;

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

describe("only what the page signed (ADR-0013)", () => {
  it("an acceptance signed by another key, or for another text, is never sent", async () => {
    const w = world();
    const other = testAcceptanceKeys();
    const forged = await w.store.create({
      id: "p-forged",
      mailUidValidity: "9",
      mailUid: 60,
      trame: null,
      draft: SECRET,
    });
    await w.store.accept(forged.id, T0, other.signed(forged, T0));
    const r = await executeDue(w.deps);
    expect(r.unsigned).toEqual(["p-forged"]);
    expect(r.sent).toEqual([]);
    expect(w.outbox).toEqual([]);
    expect((await w.store.get("p-forged"))?.status).toBe("failed");
    expect(w.journal.events.map((e) => e.type)).toContain("send.unsigned");
    expect(JSON.stringify(w.journal.events.map((e) => e.payload))).not.toContain("Claire");
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

  it(`at most ${TEST_MAX_PER_DAY} attempts a day; the rest waits`, async () => {
    const w = world();
    for (let i = 0; i < TEST_MAX_PER_DAY + 3; i++) await w.accepted();
    const r = await executeDue(w.deps);
    expect(r.limited).toBe(true);
    expect(w.outbox).toHaveLength(TEST_MAX_PER_DAY);
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

// M3 (ADR-0015): on a real box, the executor checks again what the page and
// Iris decided — the sender's authentication, its own daily limit, its undo delay.
describe("executeDue — a real box (M3)", () => {
  it("an unauthenticated sender: the accepted reply lapses, never sent", async () => {
    const w = world({ authenticated: false });
    const id = await w.accepted();
    const r = await executeDue(w.deps);
    expect(w.outbox).toEqual([]);
    expect(r.lapsed).toEqual([{ id, reason: "unauthenticated" }]);
    expect((await w.store.get(id))?.status).toBe("lapsed");
  });

  it("5 a day on a real box: the sixth waits for tomorrow", async () => {
    const w = world({ maxPerDay: 5 });
    for (let i = 0; i < 7; i++) await w.accepted();
    const r = await executeDue(w.deps);
    expect(r.limited).toBe(true);
    expect(w.outbox).toHaveLength(5);
  });

  it("a 10-minute undo delay is kept even if the row says 2 minutes", async () => {
    // The page of a test box set send_after at +2 min; the executor of a real box waits 10.
    const w = world({ undoMs: 10 * 60_000 });
    const id = await w.accepted();
    await executeDue(w.deps); // T0 + 2 min: due for the row, not for the executor
    expect(w.outbox).toEqual([]);
    expect((await w.store.get(id))?.status).toBe("accepted");
    w.at(new Date(T0.getTime() + 10 * 60_000));
    await executeDue(w.deps);
    expect(w.outbox).toHaveLength(1);
  });

  it("an acceptance cancelled within the 10 minutes is never sent", async () => {
    const w = world({ undoMs: 10 * 60_000 });
    const id = await w.accepted();
    await w.store.cancel(id, new Date(T0.getTime() + 5 * 60_000));
    w.at(new Date(T0.getTime() + 11 * 60_000));
    await executeDue(w.deps);
    expect(w.outbox).toEqual([]);
  });
});
