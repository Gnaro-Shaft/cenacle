// The keys replace addresses in the database: they must be stable, separated
// by kind, unguessable without the secret, and immune to hostile headers.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeyer, KeyError, keyerFromEnv, messageIds } from "./keys.ts";

const SECRET = "a".repeat(64);
const keyer = createKeyer(SECRET);

describe("keys", () => {
  it("are stable and case-insensitive for addresses", () => {
    expect(keyer.address("Alice@Client.example")).toBe(keyer.address("alice@client.example"));
    expect(keyer.address("alice@client.example")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differ with another secret", () => {
    expect(createKeyer("b".repeat(64)).address("a@b.example")).not.toBe(
      keyer.address("a@b.example"),
    );
  });

  it("are not a plain hash (which anyone could rebuild from a list of addresses)", () => {
    const plain = createHash("sha256").update("alice@client.example").digest("hex");
    expect(keyer.address("alice@client.example")).not.toBe(plain);
  });

  it("never share a key between an address and an identical message id", () => {
    expect(keyer.address("x@y.example")).not.toBe(keyer.messageId("x@y.example"));
  });

  it.each(["", "short", "g".repeat(64), "A".repeat(64)])("refuse the secret %j", (secret) => {
    expect(() => createKeyer(secret)).toThrow(KeyError);
  });

  it("refuse to run without a secret", () => {
    expect(() => keyerFromEnv({})).toThrow(/CENACLE_MAIL_KEY is missing/);
  });
});

describe("messageIds", () => {
  it("reads every id of a References header, in order, without duplicates", () => {
    expect(messageIds("<m1@a.test> <s1@a.test>\r\n <m1@a.test>")).toEqual([
      "m1@a.test",
      "s1@a.test",
    ]);
  });

  it.each([
    [null, []],
    ["no brackets@a.test", []],
    ["<with space@a.test>", []],
    [`<${"x".repeat(300)}@a.test>`, []],
  ])("ignores %j", (raw, ids) => {
    expect(messageIds(raw as string | null)).toEqual(ids);
  });

  it("bounds the number of ids", () => {
    const raw = Array.from({ length: 500 }, (_, i) => `<m${i}@a.test>`).join(" ");
    expect(messageIds(raw)).toHaveLength(50);
  });
});
