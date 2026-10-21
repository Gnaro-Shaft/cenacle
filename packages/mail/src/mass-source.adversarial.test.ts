// The replay reads the mass flag from a mail's raw source (reader.ts): from
// its header block only. A "List-Unsubscribe:" line in the body is text a
// sender wrote, not a header — it must not count.
import { describe, expect, it } from "vitest";
import { massOfSource } from "./reader.ts";

const src = (text: string) => Buffer.from(text, "latin1");

describe("massOfSource", () => {
  it.each([
    ["CRLF headers", "From: a@b.example\r\nList-Unsubscribe: <mailto:x@b.example>\r\n\r\nCorps"],
    ["LF headers", "From: a@b.example\nPrecedence: bulk\n\nCorps"],
    ["a folded header", "From: a@b.example\r\nList-Id: Lettre\r\n <lettre.b.example>\r\n\r\nx"],
    ["written twice", "List-Unsubscribe: <a>\r\nList-Unsubscribe: <b>\r\n\r\nx"],
    ["headers only, no body", "From: a@b.example\r\nList-Id: <l.b.example>"],
    ["upper-case name", "LIST-UNSUBSCRIBE: <a>\r\n\r\nx"],
  ])("%s: mass", (_label, text) => {
    expect(massOfSource(src(text))).toBe(true);
  });

  it.each([
    ["no list header", "From: a@b.example\r\nSubject: Bonjour\r\n\r\nCorps"],
    [
      "a List-Unsubscribe line in the body only",
      "From: a@b.example\r\nSubject: s\r\n\r\nList-Unsubscribe: <mailto:x@b.example>\r\nPrecedence: bulk",
    ],
    ["an LF body after CRLF headers", "From: a@b.example\r\n\r\nList-Id: <x>\nPrecedence: bulk"],
    ["Precedence: first-class", "Precedence: first-class\r\n\r\nx"],
    ["an empty List-Unsubscribe", "List-Unsubscribe:\r\n\r\nx"],
    ["an empty source", ""],
    ["a body only", "\r\n\r\nList-Unsubscribe: <a>"],
  ])("%s: not mass", (_label, text) => {
    expect(massOfSource(src(text))).toBe(false);
  });

  it("a List-Id after 100 000 other headers is still read, in bounded time — as the postman reads it", () => {
    const text = `${"X-Pad: a\r\n".repeat(100_000)}List-Id: <late>\r\n\r\nx`;
    const started = Date.now();
    expect(massOfSource(src(text))).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
