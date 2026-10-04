// One reply, to one person on a test domain, in the same thread: whatever the
// subject or the text holds, no header can be added and no one else reached.
import { describe, expect, it } from "vitest";
import type { ReplyContext } from "./reply-target.ts";
import { allowedRecipient, buildReply, replySubject, SendError } from "./sender.ts";

const CONTEXT: ReplyContext = {
  uid: 7,
  to: "claire@client.example",
  replyToElsewhere: false,
  subject: "Point jeudi ?",
  messageId: "<m057@client.example>",
  references: ["<s001@cenacle.test>"],
};
const FROM = "test-cenacle@cenacle.test";
const DATE = new Date("2026-10-05T10:00:00Z");
const headersOf = (raw: Buffer) => raw.toString("utf8").split("\r\n\r\n")[0] ?? "";

describe("buildReply", () => {
  it("answers in the same thread, to the sender only", async () => {
    const r = await buildReply(FROM, CONTEXT, "Bonjour Claire,\n\nJeudi me convient.", DATE);
    const h = headersOf(r.raw);
    expect(r.to).toBe("claire@client.example");
    expect(h).toMatch(/^To: claire@client\.example$/m);
    expect(h).toMatch(/^Subject: Re: Point jeudi \?$/m);
    expect(h).toMatch(/^In-Reply-To: <m057@client\.example>$/m);
    expect(h).toMatch(/^References: <s001@cenacle\.test> <m057@client\.example>$/m);
    expect(h).not.toMatch(/^(Cc|Bcc):/im);
  });

  it("says, for machines, that it was prepared with a local AI and accepted by its sender (C4)", async () => {
    const r = await buildReply(FROM, CONTEXT, "Bonjour Claire,\n\nJeudi me convient.", DATE);
    expect(headersOf(r.raw)).toMatch(
      // Header names are case-insensitive (RFC 5322): the composer writes X-Ai-Assisted.
      /^X-AI-Assisted: draft-by-local-model; reviewed-and-accepted-by-sender$/im,
    );
  });

  it("a subject cannot add a header", async () => {
    const r = await buildReply(
      FROM,
      { ...CONTEXT, subject: "Hello\r\nBcc: boss@evil.example\r\nX-Evil: 1" },
      "Bonjour",
      DATE,
    );
    const h = headersOf(r.raw);
    expect(h).not.toMatch(/^Bcc:/im);
    expect(h).not.toMatch(/^X-Evil:/im);
  });

  it("the text cannot add a header nor a recipient", async () => {
    const r = await buildReply(
      FROM,
      CONTEXT,
      "Bcc: boss@evil.example\r\n\r\nTo: x@evil.example",
      DATE,
    );
    expect(headersOf(r.raw)).not.toMatch(/evil/);
    expect(r.to).toBe("claire@client.example");
  });

  it("an invalid thread id is dropped, not copied", async () => {
    const r = await buildReply(
      FROM,
      { ...CONTEXT, messageId: "<a>\r\nBcc: x@evil.example", references: [] },
      "Bonjour",
      DATE,
    );
    const h = headersOf(r.raw);
    expect(h).not.toMatch(/In-Reply-To|evil/i);
  });

  it("re-subjects only once", () => {
    expect(replySubject("RE: déjà")).toBe("RE: déjà");
    expect(replySubject(`x${"y".repeat(300)}`)).toHaveLength(200);
  });
});

describe("allowedRecipient — phase 4 reaches nobody real", () => {
  it.each([
    "moi@exemple.fr",
    "client@gmail.com",
    "a@client.example.com",
    null,
    "a@b.example\r\nBcc: x@y.test",
  ])("refuses %j", (to) => {
    expect(() => allowedRecipient(to)).toThrow(SendError);
  });

  it.each(["claire@client.example", "x@cenacle.test"])("accepts %s", (to) => {
    expect(allowedRecipient(to)).toBe(to);
  });
});

describe("the closed list of recipients of a real box (M1)", () => {
  it("allows only my own addresses, whatever the page accepted", () => {
    expect(allowedRecipient("moi@entreprise.example", ["moi@entreprise.example"])).toBe(
      "moi@entreprise.example",
    );
    expect(() => allowedRecipient("client@client.example", ["moi@entreprise.example"])).toThrow(
      SendError,
    );
    expect(() => allowedRecipient("someone@test.test", ["moi@entreprise.example"])).toThrow(
      /closed list/,
    );
  });

  it("the fictional box still sends to reserved test domains only", () => {
    expect(() => allowedRecipient("client@gmail.com")).toThrow(/test domains only/);
  });
});
