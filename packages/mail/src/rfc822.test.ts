import type { FixtureMessage } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { sentToRfc822, toRfc822 } from "./rfc822.ts";

const message: FixtureMessage = {
  id: "m999",
  from: { name: "Inès Haddad", address: "ines@studio-pivoine.example" },
  to: "test-cenacle@cenacle.test",
  subject: "Réunion avancée à demain",
  date: "2026-09-25T08:30:00Z",
  inReplyTo: null,
  contentType: "text/plain",
  body: "Bonjour,\n\nÀ demain !\n",
  expected: { category: "clients_prospects", urgent: false, trap: null, followUp: "waiting" },
  note: "",
};

describe("toRfc822", () => {
  const raw = toRfc822(message).toString("ascii");

  it("produces pure ASCII with UTF-8 encoded words for accents", () => {
    expect([...raw].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(raw).toContain(
      `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`,
    );
  });

  it("keeps the body intact once decoded", () => {
    const body = raw.split("\r\n\r\n")[1] ?? "";
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(message.body);
  });

  it("carries a stable Message-ID and the original date", () => {
    expect(raw).toContain("Message-ID: <m999@fixtures.cenacle.test>");
    expect(raw).toContain("Date: Fri, 25 Sep 2026 08:30:00 +0000");
  });
});

describe("toRfc822 — adversarial", () => {
  it.each(["subject", "from name"])("refuses a line break smuggled into the %s", (field) => {
    const evil =
      field === "subject"
        ? { ...message, subject: "Hello\r\nBcc: victim@cenacle.test" }
        : { ...message, from: { ...message.from, name: "Eve\nX-Injected: 1" } };
    expect(() => toRfc822(evil)).toThrow(/Header injection/);
  });

  it("cannot be broken by a body that looks like headers or SMTP", () => {
    const raw = toRfc822({ ...message, body: "\r\n.\r\nSubject: forged\r\n" }).toString("ascii");
    expect(raw.split("\r\n\r\n")[0]).not.toContain("forged");
  });
});

describe("toRfc822 — display names with specials", () => {
  it("quotes a name with parentheses, so it is not read as a comment", () => {
    const raw = toRfc822({
      ...message,
      from: { name: "La Lettre (fictive)", address: "a@b.example" },
    });
    expect(raw.toString()).toContain('From: "La Lettre (fictive)" <a@b.example>');
  });

  it("escapes quotes and backslashes inside a quoted name", () => {
    const raw = toRfc822({
      ...message,
      from: { name: 'Dupont, "Al" \\ x', address: "a@b.example" },
    });
    expect(raw.toString()).toContain('From: "Dupont, \\"Al\\" \\\\ x" <a@b.example>');
  });
});

describe("toRfc822 — threads", () => {
  const sent = [
    {
      id: "s1",
      to: "ines@studio-pivoine.example",
      subject: "Re: Réunion",
      date: "2026-09-25T09:00:00Z",
      inReplyTo: "m999",
      references: ["m999"],
      body: "OK\n",
    },
  ];

  it("a reply to my sent mail carries In-Reply-To and the whole References chain", () => {
    const raw = toRfc822({ ...message, id: "m1000", inReplyTo: "s1" }, sent).toString("ascii");
    expect(raw).toContain("In-Reply-To: <s1@fixtures.cenacle.test>");
    expect(raw).toContain("References: <m999@fixtures.cenacle.test> <s1@fixtures.cenacle.test>");
  });

  it("a sent mail comes from the owner and threads to the mail it answers", () => {
    const raw = sentToRfc822(sent[0] as (typeof sent)[0], "test-cenacle@cenacle.test").toString(
      "ascii",
    );
    expect(raw).toMatch(/^From: .*<test-cenacle@cenacle\.test>/m);
    expect(raw).toContain("In-Reply-To: <m999@fixtures.cenacle.test>");
  });

  it("a fresh mail has no thread headers", () => {
    expect(toRfc822(message).toString("ascii")).not.toMatch(/In-Reply-To|References/);
  });

  it("refuses a reply to an unknown sent mail", () => {
    expect(() => toRfc822({ ...message, inReplyTo: "s404" }, sent)).toThrow(/unknown sent mail/);
  });
});
