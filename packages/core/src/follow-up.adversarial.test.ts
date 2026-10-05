// The TypeScript rule must agree, mail by mail, with the expectations the
// fixtures were built with (computed separately, in Python). Plus the cases
// that must NOT count as a reply.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureMessageId, loadFixtureMailbox, loadFixtureSent } from "./fixtures.ts";
import { type FollowedMail, followUpOf, type MyMail } from "./follow-up.ts";

// Stand-in for the HMAC keys: the rule only compares keys for equality.
const key = (kind: string, value: string) =>
  createHash("sha256").update(`${kind}:${value}`).digest("hex");
const box = loadFixtureMailbox();
const sentBox = loadFixtureSent();
const now = new Date(box.followUp.now);

const sent: MyMail[] = sentBox.messages.map((s) => ({
  sentAt: s.date,
  recipientKeys: [key("a", s.to)],
  threadKeys: s.references.map((id) => key("m", fixtureMessageId(id))),
}));

describe("follow-up — agrees with the fixtures", () => {
  it.each(box.messages.map((m) => [m.id, m] as const))("%s", (_id, m) => {
    const mail: FollowedMail = {
      category: m.expected.category,
      noFollowUp: box.followUp.noFollowUpDomains.includes(m.from.address.split("@")[1] ?? ""),
      senderAuthenticated: true,
      senderKey: key("a", m.from.address),
      messageKey: key("m", fixtureMessageId(m.id)),
      receivedAt: m.date,
    };
    expect(followUpOf(mail, sent, now)).toBe(m.expected.followUp);
  });
});

describe("follow-up — what is not a reply", () => {
  const mail: FollowedMail = {
    category: "clients_prospects",
    noFollowUp: false,
    senderAuthenticated: true,
    senderKey: "client",
    messageKey: "m1",
    receivedAt: "2026-09-28T09:00:00Z",
  };
  const late = new Date("2026-10-05T09:00:00Z");

  it("a client mail whose sender is not authenticated is never chased (ADR-0014)", () => {
    expect(followUpOf({ ...mail, senderAuthenticated: false }, [], late)).toBe("not_tracked");
  });

  it("a mail I sent BEFORE theirs", () => {
    expect(
      followUpOf(
        mail,
        [{ sentAt: "2026-09-27T09:00:00Z", recipientKeys: ["client"], threadKeys: ["m1"] }],
        late,
      ),
    ).toBe("due");
  });

  it("a mail to a colleague, outside the thread", () => {
    expect(
      followUpOf(
        mail,
        [{ sentAt: "2026-09-29T09:00:00Z", recipientKeys: ["colleague"], threadKeys: [] }],
        late,
      ),
    ).toBe("due");
  });

  it("a mail without keys never matches another one without keys", () => {
    const unkeyed = { ...mail, senderKey: null, messageKey: null };
    expect(
      followUpOf(
        unkeyed,
        [{ sentAt: "2026-09-29T09:00:00Z", recipientKeys: [], threadKeys: [] }],
        late,
      ),
    ).toBe("due");
  });

  it("an unsorted or non-client mail is not followed", () => {
    expect(followUpOf({ ...mail, category: null }, [], late)).toBe("not_tracked");
    expect(followUpOf({ ...mail, category: "bruit" }, [], late)).toBe("not_tracked");
  });
});
