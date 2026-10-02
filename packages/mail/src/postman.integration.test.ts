// Needs the test mail server: npm run db:up (starts GreenMail too).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCadre } from "./cadre.ts";
import { fetchMailRefs } from "./postman.ts";
import { loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

const envFile = join(import.meta.dirname, "..", "..", "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { password } = testMailboxConfigFromEnv();
const { mail } = loadCadre();
const { messages } = loadFixtureMailbox();

describe("postman (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(testMailboxConfigFromEnv(), messages, { reset: true });
  });

  it("reads every mail's UID and domain, and leaves them all unread", async () => {
    const result = await fetchMailRefs(mail, password);
    expect(result.refs).toHaveLength(messages.length);
    expect(result.truncated).toBe(false);
    expect(result.unseen).toBe(messages.length);
    const expected = messages.map((m) => m.from.address.split("@")[1]?.toLowerCase()).sort();
    expect(result.refs.map((r) => r.domain).sort()).toEqual(expected);
    for (const ref of result.refs) expect(Object.keys(ref).sort()).toEqual(["domain", "uid"]);
  });

  it("stops at the ceiling and resumes after the last UID", async () => {
    const small = { ...mail, maxPerFetch: 100 };
    const first = await fetchMailRefs(small, password);
    expect(first.refs).toHaveLength(100);
    expect(first.truncated).toBe(true);
    const second = await fetchMailRefs(small, password, { afterUid: first.lastUid ?? 0 });
    expect(second.refs).toHaveLength(messages.length - 100);
    expect(second.truncated).toBe(false);
    expect(second.refs[0]?.uid).toBeGreaterThan(first.lastUid ?? 0);
  });

  it("finds nothing after the last UID (no phantom last mail)", async () => {
    const all = await fetchMailRefs(mail, password);
    const after = await fetchMailRefs(mail, password, { afterUid: all.lastUid ?? 0 });
    expect(after).toMatchObject({ refs: [], available: 0, truncated: false, lastUid: null });
  });

  it("refuses a wrong password without reading anything", async () => {
    await expect(fetchMailRefs(mail, "not-the-password")).rejects.toThrow();
  });
});
