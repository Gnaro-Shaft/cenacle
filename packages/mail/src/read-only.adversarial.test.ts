// Charter: the modules that open the real mailbox read, they never write.
// These checks scan their source so a future change cannot slip a write in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const READ_ONLY_MODULES = ["postman.ts", "reader.ts"];
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

function code(file: string): string {
  const source = readFileSync(join(import.meta.dirname, file), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // comments may mention them
}

describe.each(READ_ONLY_MODULES)("%s — read-only by construction", (file) => {
  const src = code(file);

  it.each(WRITING_CALLS)("never calls %s", (name) => {
    expect(src).not.toMatch(new RegExp(`\\.${name}\\s*\\(`));
  });

  it("opens the mailbox read-only and checks it", () => {
    expect(src).toMatch(/getMailboxLock\([^)]*readOnly:\s*true/);
    expect(src).toMatch(/!client\.mailbox\.readOnly/);
  });

  it("checks the unread count did not change", () => {
    expect(src).toMatch(/unseen !== unseenBefore/);
  });
});

describe("postman — headers only", () => {
  const src = code("postman.ts");

  it("fetches a fixed list of headers — no body, no envelope, no source", () => {
    expect(src).toMatch(/INBOX_HEADERS = \["from", "message-id", "in-reply-to", "references"\]/);
    expect(src).toMatch(/SENT_HEADERS = \["to", "cc", "message-id", "in-reply-to", "references"\]/);
    for (const field of ["source", "bodyParts", "envelope", "bodyStructure"]) {
      expect(src).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    }
  });
});

describe("reader — bounded", () => {
  it("caps the bytes read per message", () => {
    expect(code("reader.ts")).toMatch(/source:\s*\{\s*maxLength:\s*MAX_SOURCE_BYTES\s*\}/);
  });
});
