// Authentication-Results can be written by the sender: the parser must read
// what a real server writes, and refuse anything it would have to guess.
import { describe, expect, it } from "vitest";
import { MAX_AUTH_RESULTS_LENGTH, parseAuthResults } from "./auth-results.ts";

describe("parseAuthResults — what a receiving server writes", () => {
  it("reads the server, each method, its result and its properties", () => {
    const parsed = parseAuthResults(
      "mx.box.test; dkim=pass (2048-bit key) header.d=client.example header.s=sel; " +
        "spf=pass smtp.mailfrom=bounce@client.example; dmarc=pass (p=none) header.from=client.example",
    );
    expect(parsed).toEqual({
      authservId: "mx.box.test",
      results: [
        {
          method: "dkim",
          result: "pass",
          props: { "header.d": "client.example", "header.s": "sel" },
        },
        { method: "spf", result: "pass", props: { "smtp.mailfrom": "bounce@client.example" } },
        { method: "dmarc", result: "pass", props: { "header.from": "client.example" } },
      ],
    });
  });

  it("lowercases, accepts a header version and a method version", () => {
    expect(parseAuthResults("MX.Box.TEST 1; DKIM/1=PASS Header.D=Client.Example")).toEqual({
      authservId: "mx.box.test",
      results: [{ method: "dkim", result: "pass", props: { "header.d": "client.example" } }],
    });
  });

  it("reads `none`, and skips the free-text reason, even with ; and = inside", () => {
    expect(parseAuthResults("mx.box.test; none")).toEqual({
      authservId: "mx.box.test",
      results: [],
    });
    expect(
      parseAuthResults('mx.box.test; spf=fail reason="not; allowed = here" smtp.mailfrom=a.test')
        ?.results,
    ).toEqual([{ method: "spf", result: "fail", props: { "smtp.mailfrom": "a.test" } }]);
  });

  it("drops comments, even when they look like results", () => {
    const value =
      "mx.box.test (dmarc=pass header.from=client.example); dmarc=fail header.from=client.example";
    expect(parseAuthResults(value)?.results).toEqual([
      { method: "dmarc", result: "fail", props: { "header.from": "client.example" } },
    ]);
  });
});

describe("parseAuthResults — forged or broken headers give null", () => {
  it.each([
    ["empty", ""],
    ["only a server", "mx.box.test"],
    ["only a server and ;", "mx.box.test;"],
    ["no server", "; dmarc=pass header.from=client.example"],
    ["two words before ;", "mx.box.test evil; dmarc=pass"],
    ["server with an @", "a@mx.box.test; dmarc=pass"],
    ["server in quotes", '"mx.box.test"; dmarc=pass'],
    ["method without result", "mx.box.test; dmarc header.from=client.example"],
    ["result with digits", "mx.box.test; dmarc=pass1"],
    ["property without dot", "mx.box.test; dmarc=pass from=client.example"],
    [
      "property said twice",
      "mx.box.test; dmarc=pass header.from=a.test header.from=client.example",
    ],
    ["unbalanced comment", "mx.box.test; dmarc=pass (header.from=client.example"],
    ["closing comment first", "mx.box.test; dmarc=pass ) header.from=client.example"],
    ["unclosed quote", 'mx.box.test; dmarc=pass header.from="client.example'],
    ["none plus a result", "mx.box.test; none; dmarc=pass"],
    ["too long", `mx.box.test; dmarc=pass header.from=${"a".repeat(MAX_AUTH_RESULTS_LENGTH)}.test`],
    ["too many results", `mx.box.test${"; spf=pass".repeat(51)}`],
    ["prototype key", "mx.box.test; dmarc=pass __proto__.x=client.example"],
  ])("%s", (_label, value) => {
    expect(parseAuthResults(value)).toBeNull();
  });

  it("never throws on hostile input", () => {
    for (const value of [
      "(((((",
      '"""',
      "\\",
      ";;;;",
      "=;=;=",
      "\u0000; dmarc=pass",
      "x;".repeat(4000),
    ]) {
      expect(() => parseAuthResults(value)).not.toThrow();
    }
  });

  it("a property named like an Object method stays a plain own value", () => {
    const parsed = parseAuthResults("mx.box.test; dmarc=pass constructor.x=client.example");
    expect(parsed?.results[0]?.props).toEqual({ "constructor.x": "client.example" });
  });
});
