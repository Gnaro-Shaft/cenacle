// The postman keeps the UID and the sender domain, nothing else.
// (Its read-only guarantees are checked in read-only.adversarial.test.ts.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "postman.ts"), "utf8");

describe("postman — minimal references", () => {
  it("keeps the UID and the domain, nothing else", () => {
    expect(source).toMatch(
      /interface MailRef \{[^}]*readonly uid: number;[^}]*readonly domain: string \| null;\s*\}/,
    );
  });
});
