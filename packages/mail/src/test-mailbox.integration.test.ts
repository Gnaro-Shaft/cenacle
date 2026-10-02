// Needs the test mail server: npm run db:up (starts GreenMail too).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import {
  connectTestMailbox,
  countInbox,
  loadFixtures,
  testMailboxConfigFromEnv,
} from "./test-mailbox.ts";

const envFile = join(import.meta.dirname, "..", "..", "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = testMailboxConfigFromEnv();
const { messages } = loadFixtureMailbox();

describe("test mailbox (GreenMail)", () => {
  it("loads every fixture, unread", async () => {
    const counts = await loadFixtures(config, messages, { reset: true });
    expect(counts).toEqual({ messages: messages.length, unseen: messages.length });
  });

  it("serves the subjects back decoded, accents included", async () => {
    const client = connectTestMailbox(config);
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const subjects: string[] = [];
        for await (const msg of client.fetch("1:*", { envelope: true })) {
          subjects.push(msg.envelope?.subject ?? "");
        }
        expect(subjects).toHaveLength(messages.length);
        expect(subjects).toContain(messages.find((m) => /[éèà]/.test(m.subject))?.subject);
      } finally {
        lock.release();
      }
      expect((await countInbox(client)).unseen).toBe(messages.length);
    } finally {
      await client.logout();
    }
  });

  it("refuses to load twice without --reset", async () => {
    await expect(loadFixtures(config, messages)).rejects.toThrow(/already holds/);
  });
});
