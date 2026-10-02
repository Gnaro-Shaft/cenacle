// Charter: the postman reads, it never writes. These checks scan its source so
// that a future change cannot slip a write command in unnoticed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "postman.ts"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // comments may mention them

const WRITING_CALLS = [
  "append",
  "messageDelete",
  "messageMove",
  "messageCopy",
  "messageFlagsAdd",
  "messageFlagsSet",
  "messageFlagsRemove",
  "setFlagColor",
  "mailboxCreate",
  "mailboxDelete",
  "mailboxRename",
  "mailboxSubscribe",
  "mailboxUnsubscribe",
  "exec",
];

describe("postman — read-only by construction", () => {
  it.each(WRITING_CALLS)("never calls %s", (name) => {
    expect(code).not.toMatch(new RegExp(`\\.${name}\\s*\\(`));
  });

  it("opens the mailbox read-only and checks it", () => {
    expect(code).toMatch(/getMailboxLock\([^)]*readOnly:\s*true/);
    expect(code).toMatch(/!client\.mailbox\.readOnly/);
  });

  it("fetches the From header only — no body, no envelope, no source", () => {
    expect(code).toMatch(/headers:\s*\["from"\]/);
    for (const field of ["source", "bodyParts", "envelope", "bodyStructure"]) {
      expect(code).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    }
  });

  it("keeps the UID and the domain, nothing else", () => {
    expect(source).toMatch(
      /interface MailRef \{[^}]*readonly uid: number;[^}]*readonly domain: string \| null;\s*\}/,
    );
  });
});
