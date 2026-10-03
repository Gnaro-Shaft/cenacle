// Needs the test mail server: npm run db:up (starts GreenMail too).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCadre } from "./cadre.ts";
import { createKeyer } from "./keys.ts";
import { fetchMailRefs } from "./postman.ts";
import { fixtureForModel, readMailsForModel } from "./reader.ts";
import { readReplyTargets } from "./reply-target.ts";
import { loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

const envFile = join(import.meta.dirname, "..", "..", "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { password } = testMailboxConfigFromEnv();
const { mail } = loadCadre();
const { messages } = loadFixtureMailbox();
const keyer = createKeyer("6".repeat(64));

describe("reader (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(testMailboxConfigFromEnv(), messages, {
      reset: true,
      sent: loadFixtureSent(),
    });
  });

  it("gives the model the same view as the fixture, and leaves every mail unread", async () => {
    const { refs, unseen } = await fetchMailRefs(mail, password, keyer);
    const uids = refs.map((r) => r.uid);
    const read = await readMailsForModel(mail, password, uids);
    expect(read).toHaveLength(messages.length);
    // Mails were appended in fixture order, so the n-th UID is the n-th fixture.
    read.forEach((m, i) => {
      const fixture = messages[i];
      if (fixture === undefined) throw new Error("missing fixture");
      expect(m).toEqual(fixtureForModel(m.uid, fixture));
    });
    const after = await fetchMailRefs(mail, password, keyer);
    expect(after.unseen).toBe(unseen);
    expect(unseen).toBe(messages.length);
  });

  it("refuses to read when the mailbox was renumbered (stale UIDs could name other mails)", async () => {
    const { refs, uidValidity } = await fetchMailRefs(mail, password, keyer);
    const uids = refs.slice(0, 2).map((r) => r.uid);
    expect(await readMailsForModel(mail, password, uids, uidValidity)).toHaveLength(2);
    await expect(readMailsForModel(mail, password, uids, `${uidValidity}9`)).rejects.toThrow(
      /renumbered/,
    );
  });

  it("reads the reply target of each mail from the server: its sender", async () => {
    const { refs, uidValidity, unseen } = await fetchMailRefs(mail, password, keyer);
    const uids = refs.slice(0, 3).map((r) => r.uid);
    const targets = await readReplyTargets(mail, password, uids, uidValidity);
    uids.forEach((uid, i) => {
      expect(targets.get(uid)?.to).toBe(
        messages[i]?.from.address.replace(/@(.*)$/, (_m, d: string) => `@${d.toLowerCase()}`),
      );
    });
    expect((await fetchMailRefs(mail, password, keyer)).unseen).toBe(unseen);
    await expect(readReplyTargets(mail, password, uids, `${uidValidity}9`)).rejects.toThrow(
      /renumbered/,
    );
  });

  it("the HTML trap reaches the model as text, its script dropped", async () => {
    const { refs } = await fetchMailRefs(mail, password, keyer);
    const index = messages.findIndex((m) => m.expected.trap === "injection_cachee_html");
    const uid = refs[index]?.uid ?? 0;
    const [trap] = await readMailsForModel(mail, password, [uid]);
    expect(trap?.text).not.toMatch(/<script|alert\(/);
    expect(trap?.text).toContain("Essayez notre IA gratuite");
  });
});
