// Needs the test mail server: npm run db:up (starts GreenMail too).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { countConversations, loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCadre } from "./cadre.ts";
import { createKeyer } from "./keys.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

// .env, and the mailbox secrets of .env.mail (S1).
for (const name of [".env", ".env.mail"]) {
  const envFile = join(import.meta.dirname, "..", "..", "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const { password } = testMailboxConfigFromEnv();
const { mail } = loadCadre();
const { messages } = loadFixtureMailbox();
const sentFixtures = loadFixtureSent();
const keyer = createKeyer("5".repeat(64));
/**
 * GreenMail 2.1.14 quirk, measured on 2026-10-02: an APPEND dated 12:xx UTC is
 * stored as 00:xx (12-hour clock parsing). Real servers keep the right time;
 * only the test server needs this correction.
 */
const greenMailDate = (iso: string) => iso.replace(/T12:/, "T00:");
const idKey = (id: string) => keyer.messageId(`${id}@fixtures.cenacle.test`);

describe("postman (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(testMailboxConfigFromEnv(), messages, {
      reset: true,
      sent: sentFixtures,
    });
  });

  it("reads every mail's UID and domain, and leaves them all unread", async () => {
    const result = await fetchMailRefs(mail, password, keyer);
    expect(result.refs).toHaveLength(messages.length);
    expect(result.truncated).toBe(false);
    expect(result.unseen).toBe(messages.length);
    const expected = messages.map((m) => m.from.address.split("@")[1]?.toLowerCase()).sort();
    expect(result.refs.map((r) => r.domain).sort()).toEqual(expected);
    for (const ref of result.refs) {
      expect(Object.keys(ref).sort()).toEqual([
        "domain",
        "messageKey",
        "receivedAt",
        "senderKey",
        "threadKeys",
        "uid",
        "urgentTerm",
      ]);
    }
  });

  it("stops at the ceiling and resumes after the last UID", async () => {
    const small = { ...mail, maxPerFetch: 100 };
    const first = await fetchMailRefs(small, password, keyer);
    expect(first.refs).toHaveLength(100);
    expect(first.truncated).toBe(true);
    const second = await fetchMailRefs(small, password, keyer, { afterUid: first.lastUid ?? 0 });
    expect(second.refs).toHaveLength(messages.length - 100);
    expect(second.truncated).toBe(false);
    expect(second.refs[0]?.uid).toBeGreaterThan(first.lastUid ?? 0);
  });

  it("finds nothing after the last UID (no phantom last mail)", async () => {
    const all = await fetchMailRefs(mail, password, keyer);
    const after = await fetchMailRefs(mail, password, keyer, { afterUid: all.lastUid ?? 0 });
    expect(after).toMatchObject({ refs: [], available: 0, truncated: false, lastUid: null });
  });

  it("refuses a wrong password without reading anything", async () => {
    await expect(fetchMailRefs(mail, "not-the-password", keyer)).rejects.toThrow();
  });

  it("keys the sender and the thread, and keeps the arrival date", async () => {
    const { refs } = await fetchMailRefs(mail, password, keyer);
    messages.forEach((m, i) => {
      const r = refs[i];
      expect(r?.senderKey, m.id).toBe(keyer.address(m.from.address));
      expect(r?.messageKey, m.id).toBe(idKey(m.id));
      // Encoded subjects are decoded before the urgency check.
      expect(r?.urgentTerm, m.id).toBe(m.expected.urgent || ["m056", "m100"].includes(m.id));
      expect(r?.receivedAt, m.id).toBe(greenMailDate(new Date(m.date).toISOString()));
    });
    const index = messages.findIndex((m) => m.id === "m005");
    expect(refs[index]?.threadKeys).toEqual([idKey("s011"), idKey("m113")]);
  });

  it("reads my sent mails: recipients and threads as keys, all of them", async () => {
    const result = await fetchSentRefs(mail, password, keyer);
    expect(result.refs).toHaveLength(sentFixtures.messages.length);
    sentFixtures.messages.forEach((s, i) => {
      const r = result.refs[i];
      expect(r?.recipientKeys, s.id).toEqual([keyer.address(s.to)]);
      expect(r?.messageKey, s.id).toBe(idKey(s.id));
      expect(r?.threadKeys, s.id).toEqual(
        s.inReplyTo === null
          ? []
          : [idKey(s.inReplyTo), ...s.references.filter((x) => x !== s.inReplyTo).map(idKey)],
      );
    });
  });

  it("rebuilds the conversations of the test mailbox", async () => {
    const inbox = (await fetchMailRefs(mail, password, keyer)).refs;
    const sent = (await fetchSentRefs(mail, password, keyer)).refs;
    // 16 replies in a thread; m005, m071 and the forged m147 join existing ones.
    expect(countConversations([...inbox, ...sent])).toBe(17);
  });
});
