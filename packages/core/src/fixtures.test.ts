import { describe, expect, it } from "vitest";
import { CATEGORIES, FOLLOW_UPS, loadFixtureMailbox, loadFixtureSent } from "./fixtures.ts";

const mailbox = loadFixtureMailbox();
const messages = mailbox.messages;

describe("fixture mailbox", () => {
  it("holds about 150 messages with unique ids", () => {
    expect(messages.length).toBeGreaterThanOrEqual(140);
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
  });

  it("uses only declared categories, and has each of them", () => {
    for (const m of messages) expect(CATEGORIES).toContain(m.expected.category);
    for (const c of CATEGORIES) expect(messages.some((m) => m.expected.category === c)).toBe(true);
  });

  it("contains traps and urgent client mails to test against", () => {
    expect(messages.filter((m) => m.expected.trap !== null).length).toBeGreaterThanOrEqual(10);
    expect(messages.filter((m) => m.expected.urgent).length).toBeGreaterThanOrEqual(5);
  });
});

describe("fixture mailbox — adversarial", () => {
  it("involves no real domain: only the reserved .example and .test TLDs", () => {
    for (const m of messages) {
      expect(m.from.address, m.id).toMatch(/\.(example|test)$/);
      expect(m.to, m.id).toMatch(/\.(example|test)$/);
    }
  });

  it("contains no link to a real domain", () => {
    for (const m of messages) {
      for (const url of m.body.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
        expect(new URL(url).hostname, m.id).toMatch(/\.(example|test)$/);
      }
    }
  });

  it("only flags client mails as urgent (a promotion shouting URGENT is not)", () => {
    for (const m of messages.filter((x) => x.expected.urgent)) {
      expect(m.expected.category, m.id).toBe("clients_prospects");
    }
  });
});

describe("fixture conversations (phase 3)", () => {
  const { messages: sent, from } = loadFixtureSent();
  const sentIds = new Set(sent.map((s) => s.id));
  const incomingIds = new Set(messages.map((m) => m.id));

  it("sent mails come from the test owner and go to reserved domains only", () => {
    expect(from).toBe("test-cenacle@cenacle.test");
    for (const s of sent) expect(s.to, s.id).toMatch(/\.(example|test)$/);
  });

  it("every thread reference points to an existing mail, sent before the reply", () => {
    const dateOf = new Map([...messages, ...sent].map((m) => [m.id, Date.parse(m.date)]));
    for (const s of sent) {
      for (const ref of s.references)
        expect(incomingIds.has(ref) || sentIds.has(ref), `${s.id} → ${ref}`).toBe(true);
      if (s.inReplyTo !== null) {
        expect(s.references.at(-1), s.id).toBe(s.inReplyTo);
        expect(dateOf.get(s.inReplyTo), s.id).toBeLessThan(Date.parse(s.date));
      }
    }
    for (const m of messages.filter((x) => x.inReplyTo !== null)) {
      expect(sentIds.has(m.inReplyTo ?? ""), m.id).toBe(true);
      expect(dateOf.get(m.inReplyTo ?? ""), m.id).toBeLessThan(Date.parse(m.date));
    }
  });

  it("only client and prospect mails are followed up, and every case is covered", () => {
    for (const m of messages) {
      expect(FOLLOW_UPS).toContain(m.expected.followUp);
      if (m.expected.category !== "clients_prospects")
        expect(m.expected.followUp, m.id).toBe("not_tracked");
    }
    for (const f of FOLLOW_UPS)
      expect(
        messages.some((m) => m.expected.followUp === f),
        f,
      ).toBe(true);
  });

  it("contains the thread traps: forged thread, reply to a colleague, fresh mail as a reply", () => {
    expect(messages.find((m) => m.expected.trap === "fil_forge")?.inReplyTo).not.toBeNull();
    expect(
      sent.some((s) => s.inReplyTo === null && messages.some((m) => m.from.address === s.to)),
    ).toBe(true);
    expect(sent.some((s) => !messages.some((m) => m.from.address === s.to))).toBe(true);
  });
});
