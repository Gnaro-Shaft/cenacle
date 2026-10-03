// The postman remembers keys, never addresses; and a header that appears twice
// is ambiguous, so it counts as unreadable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSubject, splitHeaders } from "./postman.ts";
import { senderDomain } from "./sender-domain.ts";

const source = readFileSync(join(import.meta.dirname, "postman.ts"), "utf8");

describe("postman — what it remembers", () => {
  it("MailRef holds a UID, a domain, keys, a date and an urgency flag — no address, no subject", () => {
    const block = /export interface MailRef \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const fields = [...block.matchAll(/readonly (\w+):/g)].map((m) => m[1]);
    expect(fields).toEqual([
      "uid",
      "domain",
      "senderKey",
      "messageKey",
      "threadKeys",
      "receivedAt",
      "urgentTerm",
    ]);
  });

  it("SentRef holds keys and a date only", () => {
    const block = /export interface SentRef \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const fields = [...block.matchAll(/readonly (\w+):/g)].map((m) => m[1]);
    expect(fields).toEqual(["uid", "recipientKeys", "messageKey", "threadKeys", "sentAt"]);
  });
});

describe("splitHeaders", () => {
  it("unfolds and reads each header", () => {
    const h = splitHeaders("From: Alice\r\n <a@b.example>\r\nMessage-ID: <x@y>\r\n");
    expect(h.get("from")).toBe("Alice <a@b.example>");
    expect(h.get("message-id")).toBe("<x@y>");
  });

  it("a duplicated From is ambiguous: no domain, no sender key", () => {
    const h = splitHeaders("From: <boss@client.example>\r\nFrom: <evil@attacker.test>\r\n");
    expect(h.get("from")).toBeNull();
    expect(senderDomain(h.get("from"))).toBeNull();
  });
});

describe("decodeSubject", () => {
  it("decodes UTF-8 encoded words, base64 and quoted-printable", () => {
    const b = `=?UTF-8?B?${Buffer.from("Dès que possible").toString("base64")}?=`;
    expect(decodeSubject(b)).toBe("Dès que possible");
    expect(decodeSubject("=?utf-8?Q?URGENCE_=E2=80=94_donn=C3=A9es?=")).toBe("URGENCE — données");
  });

  it("leaves unknown charsets and garbage as they are, without throwing", () => {
    expect(decodeSubject("=?x-unknown?B?AAAA?=")).toBe("=?x-unknown?B?AAAA?=");
    expect(() => decodeSubject("=?UTF-8?B?%%%?=")).not.toThrow();
    expect(decodeSubject(null)).toBe("");
  });
});
