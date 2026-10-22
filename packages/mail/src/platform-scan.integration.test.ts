// The prospection survey reads the test mailbox (GreenMail) as it would the
// real one: the mails whose sender holds the word, and not one marked read.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";
import { platformSourcesSince } from "./platform-scan.ts";
import { senderOfSource } from "./reader.ts";
import {
  connectTestMailbox,
  countInbox,
  loadFixtures,
  testMailboxConfigFromEnv,
} from "./test-mailbox.ts";

for (const name of [".env", ".env.mail"]) {
  const envFile = join(import.meta.dirname, "..", "..", "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const config = testMailboxConfigFromEnv();
const { mail } = loadCadre(CADRE_PATH);
const box = loadFixtureMailbox();

async function unread(): Promise<number> {
  const client = connectTestMailbox(config);
  await client.connect();
  try {
    return (await countInbox(client)).unseen;
  } finally {
    await client.logout();
  }
}

describe("platformSourcesSince on the test mailbox (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(config, box.messages, { reset: true, sent: loadFixtureSent() });
  });

  it("finds the platform's mails, every one, and marks none read", async () => {
    const before = await unread();
    const sources = await platformSourcesSince(
      mail,
      config.password,
      [mail.mailbox],
      new Date("2000-01-01"),
      ["plateforme-freelance"],
    );
    const expected = box.messages.filter((m) =>
      m.from.address.endsWith("@plateforme-freelance.example"),
    );
    expect(sources.map(senderOfSource).sort()).toEqual(
      expected.map((m) => m.from.address.toLowerCase()).sort(),
    );
    expect(await unread()).toBe(before);
  });

  it("a word no sender holds reads nothing", async () => {
    const sources = await platformSourcesSince(
      mail,
      config.password,
      [mail.mailbox],
      new Date("2000-01-01"),
      ["personne-ne-l-ecrit"],
    );
    expect(sources).toEqual([]);
  });
});
