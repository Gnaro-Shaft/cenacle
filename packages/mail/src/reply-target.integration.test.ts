// The subject a reply reuses, read from the test mailbox (GreenMail) exactly as
// the executor reads it, now that the raw Subject header is fetched with the
// References (raw 8-bit UTF-8 subjects, phase 5 before M2).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";
import { readReplyContexts } from "./reply-target.ts";
import { connectTestMailbox, loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

// .env, and the mailbox secrets of .env.mail (S1).
for (const name of [".env", ".env.mail"]) {
  const envFile = join(import.meta.dirname, "..", "..", "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const config = testMailboxConfigFromEnv();
// Always the fictional GreenMail box, even when a cadre.local.toml points at a real one.
const { mail } = loadCadre(CADRE_PATH);

const message = (subject: Buffer) =>
  Buffer.concat([
    Buffer.from("From: Claire <claire@client.example>\r\nTo: moi@cabinet.example\r\n"),
    Buffer.from("Message-ID: <subject-test@client.example>\r\nSubject: "),
    subject,
    Buffer.from(
      "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBonjour.\r\n",
    ),
  ]);

// GreenMail re-encodes 8-bit headers as Latin-1 when they are fetched
// (observed: "é" comes back as 0xE9, "—" as "?"), unlike a real server, which
// hands back the raw bytes. The raw UTF-8 and real Latin-1 cases are therefore
// in reply-target.adversarial.test.ts; here, what GreenMail can hold.
const SUBJECTS = [
  ["RFC 2047", Buffer.from("=?UTF-8?Q?Re=C3=A7u_=C3=A0_temps?="), "Reçu à temps"],
  [
    "an id in the subject",
    Buffer.from("Suite de <fake@evil.example>"),
    "Suite de <fake@evil.example>",
  ],
] as const;

describe("reply subject read from the test mailbox (GreenMail)", () => {
  let uidValidity = "";
  const uids: number[] = [];

  beforeAll(async () => {
    await loadFixtures(config, [], { reset: true });
    const client = connectTestMailbox(config);
    await client.connect();
    try {
      for (const [, subject] of SUBJECTS) await client.append("INBOX", message(subject), []);
      const lock = await client.getMailboxLock("INBOX");
      try {
        if (client.mailbox === false) throw new Error("INBOX did not open");
        uidValidity = String(client.mailbox.uidValidity);
        uids.push(...((await client.search({ all: true }, { uid: true })) || []));
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  });

  it("each subject comes back as written", async () => {
    expect(uids).toHaveLength(SUBJECTS.length);
    const contexts = await readReplyContexts(mail, config.password, uids, uidValidity);
    const read = [...uids].sort((a, b) => a - b).map((uid) => contexts.get(uid)?.subject);
    expect(read).toEqual(SUBJECTS.map(([, , expected]) => expected));
  });

  it("an id written in the subject never becomes a Reference", async () => {
    const contexts = await readReplyContexts(mail, config.password, uids, uidValidity);
    for (const context of contexts.values()) expect(context.references).toEqual([]);
  });
});
