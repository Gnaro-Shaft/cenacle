import { describe, expect, it } from "vitest";
import { addressList, senderAddress, senderDomain } from "./sender-domain.ts";

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

describe("senderAddress and addressList", () => {
  it("reads the sender's address, lowercased", () => {
    expect(senderAddress('From: "Alice" <Alice.Martin@Client.Example>')).toBe(
      "alice.martin@client.example",
    );
  });

  it("reads every address of a To header, quotes and comments included", () => {
    expect(
      addressList(
        'To: a@one.example, "Dupont, Bob" <bob@two.example> (team), <c@three.test>',
        "to",
      ),
    ).toEqual(["a@one.example", "bob@two.example", "c@three.test"]);
  });

  it("drops what it cannot read, and refuses groups", () => {
    expect(addressList("To: a@one.example, broken@, <x y@z.example>", "to")).toEqual([
      "a@one.example",
    ]);
    expect(addressList("To: team: a@one.example;", "to")).toEqual([]);
    expect(addressList(undefined, "to")).toEqual([]);
  });
});
