import { describe, expect, it } from "vitest";
import { loadCadre } from "./cadre.ts";

describe("cadre.toml", () => {
  it("the versioned file is valid and points at the test mailbox", () => {
    expect(loadCadre().mail).toEqual({
      host: "127.0.0.1",
      port: 3143,
      user: "test-cenacle",
      mailbox: "INBOX",
      maxPerFetch: 500,
    });
  });
});
