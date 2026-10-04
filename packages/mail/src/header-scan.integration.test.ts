// The domain census reads headers from the test mailbox (GreenMail) exactly as
// it would on the real one: everything since the date, and not one mail marked read.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";
import { censusDomains } from "./domain-census.ts";
import { headersSince } from "./header-scan.ts";
import { splitHeaders } from "./postman.ts";
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
// Always the fictional GreenMail box, even when a cadre.local.toml points at a real one.
const { mail } = loadCadre(CADRE_PATH);
const box = loadFixtureMailbox();
const sentFixtures = loadFixtureSent();

async function unread(): Promise<number> {
  const client = connectTestMailbox(config);
  await client.connect();
  try {
    return (await countInbox(client)).unseen;
  } finally {
    await client.logout();
  }
}

describe("headersSince on the test mailbox (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(config, box.messages, { reset: true, sent: sentFixtures });
  });

  it("reads every mail since the date, and marks none read", async () => {
    const before = await unread();
    const { inbox, sent } = await headersSince(mail, config.password, new Date("2000-01-01"));
    expect(inbox).toHaveLength(box.messages.length);
    expect(sent).toHaveLength(sentFixtures.messages.length);
    expect(await unread()).toBe(before);
    expect(before).toBe(box.messages.length);
  });

  it("only headers come back: From for the inbox, To/Cc for Sent — no subject", async () => {
    const { inbox, sent } = await headersSince(mail, config.password, new Date("2000-01-01"));
    expect(inbox.every((b) => /^from:/i.test(b.trim()))).toBe(true);
    expect([...inbox, ...sent].some((b) => /^subject:/im.test(b))).toBe(false);
  });

  it("a date after every mail reads nothing", async () => {
    const { inbox, sent } = await headersSince(mail, config.password, new Date("2100-01-01"));
    expect([inbox.length, sent.length]).toEqual([0, 0]);
  });

  it("the census of the fictional box finds its client domains", async () => {
    const { inbox, sent } = await headersSince(mail, config.password, new Date("2000-01-01"));
    const census = censusDomains({
      inbox: inbox.map((b) => splitHeaders(b).get("from") ?? null),
      sent: sent.map((b) => ({
        to: splitHeaders(b).get("to") ?? null,
        cc: splitHeaders(b).get("cc") ?? null,
      })),
      isOpposed: () => false,
      myDomain: "cenacle.test",
    });
    expect(census.domains.length).toBeGreaterThan(5);
    expect(census.domains.every((d) => /^[a-z0-9.-]+$/.test(d.domain))).toBe(true);
  });
});
