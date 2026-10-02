/**
 * Loads the fictional fixtures into the TEST mail server (GreenMail).
 *
 * This is the only code allowed to write into a mailbox, so it refuses any
 * server that is not on this machine: it must never touch a real mailbox.
 */
import type { FixtureMessage } from "@cenacle/core";
import { ImapFlow } from "imapflow";
import { toRfc822 } from "./rfc822.ts";

export interface TestMailboxConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export class NotATestMailboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotATestMailboxError";
  }
}

export function assertTestMailbox(config: TestMailboxConfig): void {
  if (!LOOPBACK.has(config.host)) {
    throw new NotATestMailboxError(
      `Refusing to write to ${config.host}: the test mailbox must run on this machine`,
    );
  }
}

export function testMailboxConfigFromEnv(env = process.env): TestMailboxConfig {
  const password = env.CENACLE_TEST_MAIL_PASSWORD;
  if (!password) throw new Error("CENACLE_TEST_MAIL_PASSWORD is missing (see .env.example)");
  return {
    host: env.CENACLE_TEST_MAIL_HOST ?? "127.0.0.1",
    port: Number(env.CENACLE_TEST_MAIL_IMAP_PORT ?? 3143),
    user: env.CENACLE_TEST_MAIL_USER ?? "test-cenacle",
    password,
  };
}

export function connectTestMailbox(config: TestMailboxConfig): ImapFlow {
  assertTestMailbox(config);
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: false, // GreenMail on loopback; a real mailbox will require TLS (phase 5)
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
}

export interface MailboxCounts {
  readonly messages: number;
  readonly unseen: number;
}

export async function countInbox(client: ImapFlow): Promise<MailboxCounts> {
  const status = await client.status("INBOX", { messages: true, unseen: true });
  if (status === false) throw new Error("INBOX status unavailable");
  return { messages: status.messages ?? 0, unseen: status.unseen ?? 0 };
}

/** Appends every fixture to INBOX, unread, with its original date. */
export async function loadFixtures(
  config: TestMailboxConfig,
  messages: readonly FixtureMessage[],
  options: { readonly reset?: boolean } = {},
): Promise<MailboxCounts> {
  const client = connectTestMailbox(config);
  await client.connect();
  try {
    const before = await countInbox(client);
    if (before.messages > 0) {
      if (!options.reset) {
        throw new Error(
          `INBOX already holds ${before.messages} messages — use --reset to empty the test mailbox first`,
        );
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageDelete("1:*");
      } finally {
        lock.release();
      }
    }
    for (const message of messages) {
      await client.append("INBOX", toRfc822(message), [], new Date(message.date));
    }
    return await countInbox(client);
  } finally {
    await client.logout();
  }
}
