import { describe, expect, it } from "vitest";
import { senderDomain } from "./sender-domain.ts";

describe("senderDomain", () => {
  it.each([
    ["From: alice@client.example", "client.example"],
    ["From: Alice <alice@client.example>", "client.example"],
    ['From: "Dupont, Alice" <alice@Client.Example>', "client.example"],
    ["From: =?UTF-8?B?w4lsb2RpZQ==?= <e@impots.test>\r\n", "impots.test"],
    ["From: Alice\r\n <alice@mail.client.example>", "mail.client.example"],
    ["alice@client.example (Alice)", "client.example"],
  ])("reads %j", (raw, domain) => {
    expect(senderDomain(raw)).toBe(domain);
  });
});
