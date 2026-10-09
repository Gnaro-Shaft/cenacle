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
