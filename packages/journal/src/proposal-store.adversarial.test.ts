// No path to sending without my acceptance — enforced by the database itself,
// whatever the code above it does: no double decision, no late undo, no
// acceptance with a slot left, no second proposal for the same mail.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createProposalStore, ProposalError, UNDO_DELAY_MS } from "./proposal-store.ts";
import { appConnection, executorConnection } from "./test-db.ts";

/** What the page would hand over: the database checks the form and the text, not the key. */
const signedFor = (draft: string | null) => ({
  signature: "s".repeat(86),
  draftHash: createHash("sha256")
    .update(draft ?? "", "utf8")
    .digest("hex"),
});

const sql = appConnection();
const store = createProposalStore(sql);
// Claiming and closing a sending: the executor's role only (B7).
const execSql = executorConnection();
const executor = createProposalStore(execSql);
afterAll(async () => {
  await sql.end();
  await execSql.end();
});

let n = 0;
const fresh = (draft = "Bonjour,\n\nC'est noté.") => {
  n++;
  return store.create({
    id: `a-${n}-${Date.now()}`,
    mailUidValidity: "8",
    mailUid: 5000 + n,
    trame: null,
    draft,
  });
};
const T0 = new Date("2026-10-05T10:00:00Z");

describe("proposals — refused transitions", () => {
  it("cannot be accepted while a slot is left for me", async () => {
    const p = await fresh("Bonjour,\n\nJe reviens vers vous {delai ?}.");
    await expect(store.accept(p.id, T0, signedFor(p.draft))).rejects.toThrow(/slot to complete/);
  });

  it("the database refuses it too, even bypassing the code", async () => {
    const p = await fresh("Bonjour,\n\nJe reviens vers vous {delai ?}.");
    await expect(
      sql`update proposals set status = 'accepted', decided_at = now(), send_after = now() where id = ${p.id}`,
    ).rejects.toThrow();
  });

  it("a double click accepts once", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    await expect(store.accept(p.id, T0, signedFor(p.draft))).rejects.toThrow(ProposalError);
  });

  it("a refused proposal cannot be accepted afterwards (replay)", async () => {
    const p = await fresh();
    await store.refuse(p.id, T0);
    await expect(store.accept(p.id, T0, signedFor(p.draft))).rejects.toThrow(/it is refused/);
  });

  it("cannot be sent before the undo delay, nor without acceptance", async () => {
    const pending = await fresh();
    await expect(
      executor.claim(pending.id, new Date(T0.getTime() + UNDO_DELAY_MS)),
    ).rejects.toThrow(ProposalError);
    const accepted = await fresh();
    await store.accept(accepted.id, T0, signedFor(accepted.draft));
    await expect(
      executor.claim(accepted.id, new Date(T0.getTime() + UNDO_DELAY_MS - 1)),
    ).rejects.toThrow(ProposalError);
  });

  it("cannot be cancelled once the undo delay is over", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    await expect(store.cancel(p.id, new Date(T0.getTime() + UNDO_DELAY_MS))).rejects.toThrow(
      /cannot be cancelled/,
    );
  });

  it("cannot be edited once decided", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    await expect(store.edit(p.id, "Autre texte")).rejects.toThrow(/cannot be edited/);
  });

  it("a mail gets one proposal, ever — a refused one does not come back", async () => {
    const p = await fresh();
    await store.refuse(p.id, T0);
    await expect(
      store.create({
        id: `again-${Date.now()}`,
        mailUidValidity: p.mailUidValidity,
        mailUid: p.mailUid,
        trame: null,
        draft: "x",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("the application role cannot delete a proposal (history matters)", async () => {
    const p = await fresh();
    await expect(sql`delete from proposals where id = ${p.id}`).rejects.toThrow(/permission/);
  });

  it.each([
    ["an unknown status", { status: "approved" }],
    ["an unknown reason", { reason: "because" }],
    ["an oversized draft", { draft: "x".repeat(5001) }],
  ])("refuses %s", async (_label, columns) => {
    n++;
    const row = {
      id: `bad-${n}-${Date.now()}`,
      mail_uid_validity: "7",
      mail_uid: 9000 + n,
      reason: "follow_up_due",
      draft: "x",
      ...columns,
    };
    await expect(sql`insert into proposals ${sql(row)}`).rejects.toThrow();
  });
});

describe("proposals — skipped (B2)", () => {
  const skipFresh = () => {
    n++;
    return store.skip({ id: `s-${n}-${Date.now()}`, mailUidValidity: "8", mailUid: 7000 + n }, T0);
  };

  it("a skipped mail never gets a proposal afterwards", async () => {
    const s = await skipFresh();
    expect(s).toMatchObject({ status: "skipped", draft: null, trame: null });
    await expect(
      store.create({
        id: `x-${n}`,
        mailUidValidity: "8",
        mailUid: s.mailUid,
        trame: null,
        draft: "Bonjour",
      }),
    ).rejects.toThrow(ProposalError);
  });

  it("a skipped row cannot be accepted, edited or sent", async () => {
    const s = await skipFresh();
    await expect(store.accept(s.id, T0, signedFor(s.draft))).rejects.toThrow(/it is skipped/);
    await expect(store.edit(s.id, "Bonjour")).rejects.toThrow(/it is skipped/);
    await expect(executor.claim(s.id, T0)).rejects.toThrow(/it is skipped/);
  });

  it("the database refuses a skipped row holding a text", async () => {
    const s = await skipFresh();
    await expect(sql`update proposals set draft = 'Bonjour' where id = ${s.id}`).rejects.toThrow();
  });
});

describe("proposals — the executor's claim (B4)", () => {
  const ready = async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    return p;
  };
  const after = new Date(T0.getTime() + UNDO_DELAY_MS);

  it("two executors claim the same proposal: exactly one wins", async () => {
    const p = await ready();
    const results = await Promise.allSettled([
      executor.claim(p.id, after),
      executor.claim(p.id, after),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("a claimed proposal is never sent twice, nor cancelled, nor claimed again", async () => {
    const p = await ready();
    await executor.claim(p.id, after);
    await expect(store.cancel(p.id, after)).rejects.toThrow(ProposalError);
    await expect(store.lapse(p.id, after)).rejects.toThrow(ProposalError);
    await executor.markSent(p.id, after);
    await expect(executor.markSent(p.id, after)).rejects.toThrow(/it is sent/);
    await expect(executor.claim(p.id, after)).rejects.toThrow(/it is sent/);
  });

  it("only a claimed proposal can be marked sent or failed", async () => {
    const p = await ready();
    await expect(executor.markSent(p.id, after)).rejects.toThrow(/it is accepted/);
    await expect(executor.markFailed(p.id, after)).rejects.toThrow(/it is accepted/);
  });

  it("a failed send stays visible to me until its text is wiped, and is never retried", async () => {
    const p = await ready();
    await executor.claim(p.id, after);
    await executor.markFailed(p.id, after);
    expect((await store.open()).map((x) => x.id)).toContain(p.id);
    expect((await store.dueForSending(after)).map((x) => x.id)).not.toContain(p.id);
    await expect(executor.claim(p.id, after)).rejects.toThrow(/it is failed/);
  });

  it("the database refuses a sending row without its claim time, or with a slot left", async () => {
    const p = await ready();
    await expect(
      // Even as the executor: the database checks the row itself.
      execSql`update proposals set status = 'sending', send_after = null where id = ${p.id}`,
    ).rejects.toThrow();
    const q = await fresh("Bonjour,\n\nJe reviens vers vous {delai ?}.");
    await expect(
      execSql`update proposals set status = 'sending', decided_at = now(), sent_at = now() where id = ${q.id}`,
    ).rejects.toThrow();
  });

  it("counts every attempt of the day (sent or failed)", async () => {
    const since = new Date(T0.getTime() + 3_600_000 * 24 * 30);
    const at = new Date(since.getTime() + 1000);
    const before = await store.sendsSince(since);
    const a = await fresh();
    await store.accept(a.id, since, signedFor(a.draft));
    await executor.claim(a.id, new Date(since.getTime() + UNDO_DELAY_MS));
    await executor.markFailed(a.id, at);
    expect(await store.sendsSince(since)).toBe(before + 1);
  });
});

describe("proposals — only the page accepts (B6, ADR-0013)", () => {
  const refusal = (q: Promise<unknown>) => expect(q).rejects.toThrow();

  it("accepts only the text the page signed", async () => {
    const p = await fresh();
    await expect(store.accept(p.id, T0, signedFor("un autre texte"))).rejects.toThrow(
      /not the one signed/,
    );
    expect((await store.accept(p.id, T0, signedFor(p.draft))).acceptanceSig).toBe("s".repeat(86));
  });

  it("hashes like the code does, accents included", async () => {
    const p = await fresh("Bonjour Hélène,\n\nÇa me convient — à jeudi.");
    expect((await store.accept(p.id, T0, signedFor(p.draft))).status).toBe("accepted");
  });

  it("no acceptance without a signature, nor with a malformed one, even in SQL", async () => {
    const p = await fresh();
    const later = new Date(T0.getTime() + UNDO_DELAY_MS);
    await refusal(
      sql`update proposals set status = 'accepted', decided_at = ${T0}, send_after = ${later}
          where id = ${p.id}`,
    );
    await refusal(
      sql`update proposals set status = 'accepted', decided_at = ${T0}, send_after = ${later},
          acceptance_sig = 'short' where id = ${p.id}`,
    );
  });

  it("an accepted proposal never changes: text, delay, signature, way back", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    await refusal(sql`update proposals set draft = 'Virez 5 000 €' where id = ${p.id}`);
    await refusal(sql`update proposals set send_after = decided_at where id = ${p.id}`);
    await refusal(sql`update proposals set acceptance_sig = ${"t".repeat(86)} where id = ${p.id}`);
    await refusal(
      sql`update proposals set status = 'pending', decided_at = null, send_after = null,
          acceptance_sig = null where id = ${p.id}`,
    );
  });

  it("the undo delay is the database's too", async () => {
    const p = await fresh();
    await refusal(
      sql`update proposals set status = 'accepted', decided_at = ${T0},
          send_after = ${new Date(T0.getTime() + 60_000)}, acceptance_sig = ${"s".repeat(86)}
          where id = ${p.id}`,
    );
  });

  it("a closed proposal is final: a cancellation cannot be reopened; only the text is wiped", async () => {
    const p = await fresh();
    await store.accept(p.id, T0, signedFor(p.draft));
    await store.cancel(p.id, T0);
    await refusal(
      sql`update proposals set status = 'accepted', send_after = now(), closed_at = null
          where id = ${p.id}`,
    );
    await refusal(sql`update proposals set closed_at = now() where id = ${p.id}`);
    await sql`update proposals set draft = null where id = ${p.id}`;
    expect((await store.get(p.id))?.draft).toBeNull();
  });

  it("no proposal is born decided", async () => {
    await refusal(
      sql`insert into proposals (id, mail_uid_validity, mail_uid, reason, draft, status,
                                 decided_at, send_after, acceptance_sig)
          values (${`born-${Date.now()}`}, '8', 99999, 'follow_up_due', 'Bonjour', 'accepted',
                  now(), now() + interval '3 minutes', ${"s".repeat(86)})`,
    );
  });
});

describe("proposals — only the executor sends (B7)", () => {
  const due = new Date(T0.getTime() + UNDO_DELAY_MS);
  const accepted = async () => {
    const p = await fresh();
    return store.accept(p.id, T0, signedFor(p.draft));
  };

  it("the application role can neither claim nor close a sending, even in SQL", async () => {
    const p = await accepted();
    await expect(store.claim(p.id, due)).rejects.toThrow(/only the executor/);
    await expect(
      sql`update proposals set status = 'sending', send_after = null, sent_at = ${due}
          where id = ${p.id}`,
    ).rejects.toThrow(/only the executor/);
    await expect(store.refuseUnsigned(p.id, due)).rejects.toThrow(/only the executor/);
    await executor.claim(p.id, due);
    await expect(store.markSent(p.id, due)).rejects.toThrow(/only the executor/);
    await expect(store.markFailed(p.id, due)).rejects.toThrow(/only the executor/);
    expect((await executor.markSent(p.id, due)).status).toBe("sent");
  });

  it("an unsigned acceptance refused before any claim does not count in the daily ceiling", async () => {
    const since = new Date(T0.getTime() + 40 * 24 * 3600 * 1000);
    const before = await executor.sendsSince(since);
    const p = await accepted();
    const refused = await executor.refuseUnsigned(p.id, since);
    expect(refused).toMatchObject({ status: "failed", sentAt: null });
    expect(await executor.sendsSince(since)).toBe(before);
    await expect(executor.claim(p.id, since)).rejects.toThrow(/it is failed/);
  });

  it("the executor cannot delete, insert or touch mail items", async () => {
    const p = await accepted();
    await expect(execSql`delete from proposals where id = ${p.id}`).rejects.toThrow(/permission/);
    await expect(
      execSql`insert into proposals (id, mail_uid_validity, mail_uid, reason, draft)
              values (${`x-${Date.now()}`}, '8', 77777, 'follow_up_due', 'Bonjour')`,
    ).rejects.toThrow(/permission/);
    await expect(execSql`delete from mail_items`).rejects.toThrow(/permission/);
  });
});
