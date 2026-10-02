import type { FixtureMessage } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { toRfc822 } from "./rfc822.ts";

const message: FixtureMessage = {
  id: "m999",
  from: { name: "Inès Haddad", address: "ines@studio-pivoine.example" },
  to: "test-cenacle@cenacle.test",
  subject: "Réunion avancée à demain",
  date: "2026-09-25T08:30:00Z",
  contentType: "text/plain",
  body: "Bonjour,\n\nÀ demain !\n",
  expected: { category: "clients_prospects", urgent: false, trap: null },
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
