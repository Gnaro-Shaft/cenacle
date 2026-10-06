// Iris reads every folder (ADR-0016), on the test mailbox (GreenMail): a mail
// I really move with IMAP keeps its id and its category; a mail moved out of
// the folders Iris reads is forgotten. A temporary folder, removed after.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox } from "@cenacle/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";
import { collectMail } from "./collect.ts";
import { listFolders } from "./folders.ts";
import { createKeyer } from "./keys.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { EXAMPLE_RULES_PATH, loadRules } from "./rules.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { memoryLocationStore } from "./test-locations.ts";
import { connectTestMailbox, loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

for (const name of [".env", ".env.mail"]) {
  const envFile = join(import.meta.dirname, "..", "..", "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const config = testMailboxConfigFromEnv();
// Always the fictional GreenMail box, even when a cadre.local.toml points at a real one.
const { mail } = loadCadre(CADRE_PATH);
const keyer = createKeyer("7".repeat(64));
const FOLDER = "Clients-iris-test";

async function withClient<T>(run: (c: ReturnType<typeof connectTestMailbox>) => Promise<T>) {
  const client = connectTestMailbox(config);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout();
  }
}

describe("every folder, on the test mailbox (GreenMail)", () => {
  const journal = memoryJournal();
  const store = memoryMailStore();
  const locations = memoryLocationStore();
  const { rules, noFollowUp } = loadRules({
    local: "/nonexistent.toml",
    example: EXAMPLE_RULES_PATH,
  });
  const pass = () =>
    collectMail({
      journal,
      store,
      rules,
      noFollowUp,
      retentionDays: 3650,
      opposedKeys: new Set(),
      notBefore: null,
      folders: () => listFolders(mail, config.password, keyer),
      fetchFolder: (path, afterUid) =>
        fetchMailRefs({ ...mail, mailbox: path }, config.password, keyer, { afterUid }),
      locations,
      fetchSent: (afterUid) => fetchSentRefs(mail, config.password, keyer, { afterUid }),
    });

  beforeAll(async () => {
    await loadFixtures(config, loadFixtureMailbox().messages.slice(0, 4), { reset: true });
    await withClient(async (c) => {
      await c.mailboxDelete(FOLDER).catch(() => undefined);
      await c.mailboxCreate(FOLDER);
    });
  });
  afterAll(async () => {
    await withClient((c) => c.mailboxDelete(FOLDER).catch(() => undefined));
  });

  it("reads the new folder too, and a mail I move keeps its id and its category", async () => {
    const first = await pass();
    expect(first.count).toBe(4);
    const before = (await store.inbox()).map((m) => [m.uid, m.category]);
    await withClient(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        await c.messageMove("1:2", FOLDER);
      } finally {
        lock.release();
      }
    });
    const second = await pass();
    expect(second.count).toBe(0);
    expect(second.purged).toBe(0);
    expect((await store.inbox()).map((m) => [m.uid, m.category])).toEqual(before);
    const moved = journal.events.filter((e) => e.type === "mail.fetched").at(-1)?.payload;
    expect(moved).toMatchObject({ moved: 2, count: 0 });
  });

  it("the folder deleted with its mails: they are forgotten, the others stay", async () => {
    await withClient((c) => c.mailboxDelete(FOLDER));
    const third = await pass();
    expect(third.purged).toBe(2);
    expect(await store.inbox()).toHaveLength(2);
  });
});
