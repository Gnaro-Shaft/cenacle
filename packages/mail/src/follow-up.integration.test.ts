// Needs the test mail server: npm run db:up (starts GreenMail too).
// The whole chain on the test mailbox: IMAP (inbox + Sent) → keys → memory →
// follow-up rule, at the fixtures' clock. The model is stood in for by the
// expected categories, so that only the follow-up chain is measured here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { countFollowUps, FOLLOW_UPS, loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCadre } from "./cadre.ts";
import { collectMail } from "./collect.ts";
import { createKeyer } from "./keys.ts";
import { fetchMailRefs, fetchSentRefs } from "./postman.ts";
import { EXAMPLE_RULES_PATH, loadRules } from "./rules.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

const envFile = join(import.meta.dirname, "..", "..", "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { password } = testMailboxConfigFromEnv();
const { mail } = loadCadre();
const box = loadFixtureMailbox();
const keyer = createKeyer("7".repeat(64));

describe("follow-up on the test mailbox (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(testMailboxConfigFromEnv(), box.messages, {
      reset: true,
      sent: loadFixtureSent(),
    });
  });

  it("finds exactly the expected replied / waiting / due mails", async () => {
    const store = memoryMailStore();
    const { rules, noFollowUp } = loadRules({
      local: "/nonexistent/x.toml",
      example: EXAMPLE_RULES_PATH,
    });
    const summary = await collectMail({
      journal: memoryJournal(),
      store,
      rules,
      noFollowUp,
      clock: () => new Date(box.followUp.now),
      fetchInbox: (afterUid) => fetchMailRefs(mail, password, keyer, { afterUid }),
      fetchSent: (afterUid) => fetchSentRefs(mail, password, keyer, { afterUid }),
    });
    // Mails were appended in fixture order: the n-th remembered UID is the n-th fixture.
    const uids = (await store.inbox()).map((i) => i.uid);
    for (const uid of summary.uncategorized) {
      const fixture = box.messages[uids.indexOf(uid)];
      if (fixture === undefined) throw new Error(`no fixture for UID ${uid}`);
      await store.categorize(uid, fixture.expected.category, "model");
    }
    const counts = countFollowUps(
      await store.inbox(),
      await store.sent(),
      new Date(box.followUp.now),
    );
    const expected = Object.fromEntries(
      FOLLOW_UPS.map((f) => [f, box.messages.filter((m) => m.expected.followUp === f).length]),
    );
    expect(counts).toEqual(expected);
  });
});
