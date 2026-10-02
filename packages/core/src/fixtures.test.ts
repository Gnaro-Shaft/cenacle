import { describe, expect, it } from "vitest";
import { CATEGORIES, loadFixtureMailbox } from "./fixtures.ts";

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
