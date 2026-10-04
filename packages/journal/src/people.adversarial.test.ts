// People's rights (C3): an export holds that person and nobody else; an
// erasure removes them everywhere, touches nobody else, holds against a reply
// being sent, and puts them on the opposition list.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createMailStore } from "./mail-store.ts";
import { createPeople } from "./people.ts";
import { createProposalStore } from "./proposal-store.ts";
import { appConnection, executorConnection } from "./test-db.ts";

const sql = appConnection();
const execSql = executorConnection();
afterAll(async () => {
  await sql.end();
  await execSql.end();
});
const mails = createMailStore(sql);
const store = createProposalStore(sql);
const executor = createProposalStore(execSql);
const people = createPeople(sql);

const T0 = new Date("2026-10-05T10:00:00Z");
const signed = (draft: string | null) => ({
  signature: "s".repeat(86),
  draftHash: createHash("sha256")
    .update(draft ?? "", "utf8")
    .digest("hex"),
});
let base = 50_000 + Math.floor(Math.random() * 10_000) * 10;
const hex = (c: string) => c.repeat(64);

/** Two people, A and B, each with mails, one sent mail to both, and proposals. */
async function world() {
  base += 10;
  const A = createHash("sha256").update(`a${base}`).digest("hex");
  const B = createHash("sha256").update(`b${base}`).digest("hex");
  // The test database is shared: keep the mailbox numbering already there, if any.
  const inboxV = (await mails.position("inbox"))?.uidValidity ?? "31";
  const sentV = (await mails.position("sent"))?.uidValidity ?? "32";
  const item = (uid: number, sender: string) => ({
    uid,
    receivedAt: T0.toISOString(),
    noFollowUp: false,
    urgentTerm: false,
    senderKey: sender,
    messageKey: hex("e"),
    threadKeys: [],
  });
  await mails.saveInbox(inboxV, [item(base + 1, A), item(base + 2, A), item(base + 3, B)]);
  await mails.saveSent(sentV, [
    {
      uid: base + 4,
      sentAt: T0.toISOString(),
      recipientKeys: [A, B],
      messageKey: hex("f"),
      threadKeys: [],
    },
  ]);
  const propose = (uid: number, id: string) =>
    store.create({
      id: `${id}-${base}`,
      mailUidValidity: inboxV,
      mailUid: uid,
      trame: null,
      draft: `Bonjour ${id}`,
    });
  const aPending = await propose(base + 1, "apend");
  const aAccepted = await propose(base + 2, "aacc");
  await store.accept(aAccepted.id, T0, signed(aAccepted.draft));
  const bPending = await propose(base + 3, "bpend");
  return { A, B, aPending, aAccepted, bPending };
}

describe("export (access, portability)", () => {
  it("holds that person's mails, sent mails and proposals — and nobody else's", async () => {
    const w = await world();
    const held = await people.holdings(w.A);
    expect(held.received).toHaveLength(2);
    expect(held.sentTo).toHaveLength(1);
    expect(held.proposals.map((p) => p.draft).sort()).toEqual(["Bonjour aacc", "Bonjour apend"]);
    expect(JSON.stringify(held)).not.toContain("bpend");
    expect(held.opposed).toBe(false);
  });

  it("an unknown person holds nothing; a malformed key is refused", async () => {
    const held = await people.holdings(hex("9"));
    expect(held).toMatchObject({ received: [], sentTo: [], proposals: [], opposed: false });
    await expect(people.holdings("alice@client.example")).rejects.toThrow(/not a key/);
  });
});

describe("erasure", () => {
  it("removes them everywhere, keeps the others, and puts them on the opposition list", async () => {
    const w = await world();
    expect(await people.erase(w.A)).toEqual({ received: 2, sentTo: 1, proposals: 2 });
    expect(await people.holdings(w.A)).toMatchObject({
      received: [],
      sentTo: [],
      proposals: [],
      opposed: true,
    });
    expect(await store.get(w.aAccepted.id)).toBeNull(); // accepted: it will never be sent
    expect((await store.get(w.bPending.id))?.status).toBe("pending");
    const b = await people.holdings(w.B);
    expect(b.received).toHaveLength(1);
    expect(b.sentTo).toHaveLength(1); // the mail sent to both keeps B
    expect((await people.opposedKeys()).has(w.A)).toBe(true);
    expect((await people.opposedKeys()).has(w.B)).toBe(false);
  });

  it("refused while a reply to them is being sent — and then nothing at all is erased", async () => {
    const w = await world();
    await executor.claim(w.aAccepted.id, new Date(T0.getTime() + 120_000));
    await expect(people.erase(w.A)).rejects.toThrow(/being sent/);
    const held = await people.holdings(w.A);
    expect(held.received).toHaveLength(2);
    expect(held.opposed).toBe(false);
  });

  it("they can withdraw their objection", async () => {
    const w = await world();
    await people.erase(w.A);
    expect(await people.withdraw(w.A)).toBe(true);
    expect(await people.withdraw(w.A)).toBe(false);
    expect((await people.opposedKeys()).has(w.A)).toBe(false);
  });

  it("the application role still cannot delete proposals directly, nor put a non-key on the list", async () => {
    const w = await world();
    await expect(sql`delete from proposals where id = ${w.bPending.id}`).rejects.toThrow(
      /permission/,
    );
    await expect(
      sql`insert into opposed_keys (key) values ('alice@client.example')`,
    ).rejects.toThrow();
  });
});

describe("the opposition list in the encrypted backup", () => {
  it("is read back whole, and written back without duplicates", async () => {
    const w = await world();
    await people.erase(w.A);
    const backup = await people.opposition();
    const mine = backup.find((e) => e.key === w.A);
    expect(mine?.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Lost, then restored from the backup: back on the list, once.
    await people.withdraw(w.A);
    expect(await people.restoreOpposition(backup)).toBeGreaterThanOrEqual(1);
    expect((await people.opposedKeys()).has(w.A)).toBe(true);
    expect(await people.restoreOpposition(backup)).toBe(0);
  });

  it("refuses something that is not a key or has no date", async () => {
    await expect(
      people.restoreOpposition([{ key: "alice@client.example", since: "2026-10-04T10:00:00Z" }]),
    ).rejects.toThrow(/not a key/);
    await expect(people.restoreOpposition([{ key: hex("7"), since: "hier" }])).rejects.toThrow(
      /valid date/,
    );
  });
});
