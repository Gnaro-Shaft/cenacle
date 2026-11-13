import { describe, expect, it } from "vitest";
import { ProjectionError } from "./agent-status.ts";
import { errorText, type SafeErrorClass, UsageError } from "./error-text.ts";

// Synthetic values only.
const ADDRESS = "someone@example.test";
const leaky = (name = "PostgresError") =>
  Object.assign(new Error(`password authentication failed for ${ADDRESS} on db.example.test`), {
    name,
  });

class KnownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnownError";
  }
}

describe("errorText", () => {
  it("names an unknown error, never quotes it", () => {
    expect(errorText(leaky())).toBe("PostgresError");
    expect(errorText(new TypeError(`cannot read ${ADDRESS}`))).toBe("TypeError");
  });

  it("keeps the messages the project writes itself", () => {
    expect(errorText(new UsageError("--max attend un nombre positif"))).toBe(
      "--max attend un nombre positif",
    );
    expect(errorText(new KnownError("trop long"), [KnownError])).toBe("trop long");
  });

  it("keeps the message of a subclass of a safe class", () => {
    class Narrower extends KnownError {}
    expect(errorText(new Narrower("x"), [KnownError])).toBe("x");
  });

  it("never takes Error itself as a safe class, however it is passed", () => {
    expect(errorText(leaky(), [Error])).toBe("PostgresError");
    expect(errorText(leaky(), [KnownError, Error as SafeErrorClass])).toBe("PostgresError");
  });

  it("does not let a safe class vouch for an unrelated error", () => {
    expect(errorText(leaky(), [KnownError, ProjectionError])).toBe("PostgresError");
  });

  it.each([
    ["an address", ADDRESS],
    ["a sentence", "connect ECONNREFUSED 10.0.0.1:5432"],
    ["an empty name", ""],
    ["a name too long to be a class", "E".repeat(41)],
    ["a line break", "Error\nsomeone"],
  ])("refuses a name holding %s", (_label, name) => {
    expect(errorText(leaky(name))).toBe("Error");
  });

  it.each([
    ["a string", ADDRESS],
    ["an object", { message: ADDRESS }],
    ["null", null],
    ["undefined", undefined],
  ])("says only 'erreur' for a thrown %s", (_label, thrown) => {
    expect(errorText(thrown)).toBe("erreur");
    expect(errorText(thrown, [KnownError])).toBe("erreur");
  });

  it("does not trust an object forged to look like a UsageError", () => {
    const forged = { name: "UsageError", message: ADDRESS };
    expect(errorText(forged)).toBe("erreur");
    const renamed = Object.assign(new Error(ADDRESS), { name: "UsageError" });
    expect(errorText(renamed)).toBe("UsageError");
  });
});

describe("errorText — codes and causes (lot C, 13/11)", () => {
  const withCode = (code: unknown, name = "Error") =>
    Object.assign(new Error(`connect ${ADDRESS}`), { name, code });

  it.each([
    ["a Node code", "ECONNREFUSED", "Error (ECONNREFUSED)"],
    ["an undici code", "UND_ERR_CONNECT_TIMEOUT", "Error (UND_ERR_CONNECT_TIMEOUT)"],
    ["a SQLSTATE", "57P01", "Error (57P01)"],
    ["a SQLSTATE of letters", "28P01", "Error (28P01)"],
  ])("adds %s", (_label, code, text) => {
    expect(errorText(withCode(code))).toBe(text);
  });

  it.each([
    ["an address", ADDRESS],
    ["a sentence", "connection refused"],
    ["a lower-case word", "econnrefused"],
    ["a number", 42],
    ["a code too long", `E${"X".repeat(40)}`],
    ["a line break", "EPIPE\nsomeone"],
    ["an empty code", ""],
  ])("never adds a code holding %s", (_label, code) => {
    expect(errorText(withCode(code))).toBe("Error");
  });

  it("names the cause, never its message: fetch failed ← why", () => {
    const cause = Object.assign(new Error(`connect to ${ADDRESS}`), { code: "ECONNREFUSED" });
    const failed = new TypeError("fetch failed", { cause });
    expect(errorText(failed)).toBe("TypeError ← Error (ECONNREFUSED)");
  });

  it("one level of cause only, and a cause that is not an Error is ignored", () => {
    const deep = new Error("a", {
      cause: new RangeError("b", { cause: new SyntaxError(ADDRESS) }),
    });
    expect(errorText(deep)).toBe("Error ← RangeError");
    expect(errorText(new Error("a", { cause: ADDRESS }))).toBe("Error");
  });

  it("a safe class keeps its message alone, without code nor cause", () => {
    const usage = Object.assign(new UsageError("--max attend un nombre"), { code: "EUSAGE" });
    expect(errorText(usage)).toBe("--max attend un nombre");
  });
});
