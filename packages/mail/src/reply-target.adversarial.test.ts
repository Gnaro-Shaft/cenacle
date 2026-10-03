// The reply always goes to the sender: a Reply-To elsewhere is reported and
// ignored; an unreadable or multiple sender leaves no target at all.
import { describe, expect, it } from "vitest";
import { replyTargetOf, safeAddress } from "./reply-target.ts";

describe("replyTargetOf", () => {
  it("answers the sender", () => {
    expect(replyTargetOf(1, [{ address: "claire@Client.Example" }], undefined)).toEqual({
      uid: 1,
      to: "claire@client.example",
      replyToElsewhere: false,
    });
  });

  it("a Reply-To to the same address is fine", () => {
    const t = replyTargetOf(
      1,
      [{ address: "claire@client.example" }],
      [{ address: "Claire@client.example" }],
    );
    expect(t.replyToElsewhere).toBe(false);
  });

  it("a Reply-To elsewhere is reported, never used", () => {
    const t = replyTargetOf(
      1,
      [{ address: "dg@client.example" }],
      [{ address: "paiements@autre-domaine.example" }],
    );
    expect(t).toEqual({ uid: 1, to: "dg@client.example", replyToElsewhere: true });
  });

  it.each([
    ["no sender", undefined],
    ["two senders", [{ address: "a@x.example" }, { address: "b@y.example" }]],
    ["no address", [{}]],
  ])("%s: no target", (_label, from) => {
    expect(replyTargetOf(1, from, undefined).to).toBeNull();
  });
});

describe("safeAddress", () => {
  it.each([
    "a@b",
    "a b@c.example",
    "a@c.example\r\nBcc: x@evil.example",
    "a@c.example,b@d.example",
    "<a@c.example>",
    "a@-.example\n",
    "a@-evil.example",
    "a@evil-.example",
    "a@evil..example",
    `${"a".repeat(65)}@c.example`,
    "",
  ])("refuses %j", (raw) => {
    expect(safeAddress(raw)).toBeNull();
  });

  it("keeps the local part, lower-cases the domain", () => {
    expect(safeAddress(" Jean.Dupont+cenacle@Client.EXAMPLE ")).toBe(
      "Jean.Dupont+cenacle@client.example",
    );
  });
});
