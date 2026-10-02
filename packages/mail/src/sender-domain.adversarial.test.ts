// The From header is written by whoever sent the mail: it must never be
// able to pass for someone else, nor crash the postman.
import { describe, expect, it } from "vitest";
import { senderDomain } from "./sender-domain.ts";

describe("senderDomain — forged or broken headers", () => {
  it("ignores an address hidden in the display name", () => {
    expect(senderDomain('From: "boss@client.example" <evil@attacker.test>')).toBe("attacker.test");
  });

  it("ignores an address hidden in a comment", () => {
    expect(senderDomain("From: (boss@client.example) evil@attacker.test")).toBe("attacker.test");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["no address", "From: Alice"],
    ["no domain", "From: alice@"],
    ["no local part", "From: @client.example"],
    ["two @", "From: a@b@client.example"],
    ["two senders", "From: a@one.example, b@two.example"],
    ["two angle addresses", "From: <a@one.example> <b@two.example>"],
    ["group syntax", "From: team: a@one.example;"],
    ["unclosed angle", "From: Alice <alice@client.example"],
    ["unclosed quote", 'From: "Alice <alice@client.example>'],
    ["unbalanced comment", "From: Alice) <alice@client.example>"],
    ["single-label domain", "From: root@localhost"],
    ["IP literal", "From: a@[127.0.0.1]"],
    ["underscore in domain", "From: a@cli_ent.example"],
    ["trailing dot", "From: a@client.example."],
    ["header injection", "From: a@client.example\r\nBcc: x@attacker.test"],
    ["space in local part", "From: <a b@client.example>"],
    ["oversized", `From: ${"a".repeat(3000)}@client.example`],
    ["label too long", `From: a@${"b".repeat(64)}.example`],
  ])("gives null for %s", (_label, raw) => {
    expect(senderDomain(raw)).toBeNull();
  });

  it("never throws, whatever the bytes", () => {
    const samples = ["\u0000", "<<>>", '"""', "((()))", "\\", "@", "<@>", "From:", "￿@x.y"];
    for (const raw of samples) expect(() => senderDomain(raw)).not.toThrow();
  });
});
