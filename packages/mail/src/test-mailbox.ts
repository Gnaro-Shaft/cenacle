/**
 * Loads the fictional fixtures into the TEST mail server (GreenMail).
 *
 * This is the only code allowed to write into a mailbox, so it refuses any
 * server that is not on this machine — unless the real mailbox is explicitly
 * marked as a test one (`test = true` in cadre.local.toml, M1). It must never
 * touch a production mailbox.
 */
import { type FixtureMessage, type FixtureSentFolder, UsageError } from "@cenacle/core";
import { ImapFlow } from "imapflow";
import { imapOptions } from "./connection.ts";
import { sentToRfc822, toRfc822 } from "./rfc822.ts";

export interface TestMailboxConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** A real mailbox marked `test = true` in the cadre (M1); false or absent otherwise. */
  readonly markedTest?: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export class NotATestMailboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotATestMailboxError";
  }
}

export function assertTestMailbox(config: TestMailboxConfig): void {
  if (!LOOPBACK.has(config.host) && config.markedTest !== true) {
    throw new NotATestMailboxError(
      `Refusing to write to ${config.host}: not on this machine, and not marked as a test mailbox`,
    );
  }
}

export function testMailboxConfigFromEnv(env = process.env): TestMailboxConfig {
  const password = env.CENACLE_TEST_MAIL_PASSWORD;
  if (!password) throw new UsageError("CENACLE_TEST_MAIL_PASSWORD is missing (see .env.example)");
  return {
    host: env.CENACLE_TEST_MAIL_HOST ?? "127.0.0.1",
    port: Number(env.CENACLE_TEST_MAIL_IMAP_PORT ?? 3143),
    user: env.CENACLE_TEST_MAIL_USER ?? "test-cenacle",
    password,
  };
}

export function connectTestMailbox(config: TestMailboxConfig): ImapFlow {
  assertTestMailbox(config);
  return new ImapFlow(imapOptions(config, config.password));
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

export const SENT_MAILBOX = "Sent";

async function emptyMailbox(client: ImapFlow, mailbox: string): Promise<void> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    if (client.mailbox !== false && client.mailbox.exists > 0) await client.messageDelete("1:*");
  } finally {
    lock.release();
  }
}

async function ensureMailbox(client: ImapFlow, mailbox: string): Promise<void> {
  const existing = await client.list();
  if (!existing.some((box) => box.path === mailbox)) await client.mailboxCreate(mailbox);
}

export interface LoadOptions {
  readonly reset?: boolean;
  /** My sent mails: loaded into the Sent folder, already read. */
  readonly sent?: FixtureSentFolder;
}

/** Appends every fixture to INBOX (unread, original date), and my sent mails to Sent. */
export async function loadFixtures(
  config: TestMailboxConfig,
  messages: readonly FixtureMessage[],
  options: LoadOptions = {},
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
      await emptyMailbox(client, "INBOX");
    }
    const sent = options.sent?.messages ?? [];
    for (const message of messages) {
      await client.append("INBOX", toRfc822(message, sent), [], new Date(message.date));
    }
    if (options.sent !== undefined) {
      await ensureMailbox(client, SENT_MAILBOX);
      await emptyMailbox(client, SENT_MAILBOX);
      for (const message of sent) {
        const raw = sentToRfc822(message, options.sent.from);
        await client.append(SENT_MAILBOX, raw, ["\\Seen"], new Date(message.date));
      }
    }
    return await countInbox(client);
  } finally {
    await client.logout();
  }
}

export async function countMailbox(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { messages: true });
  if (status === false) throw new Error(`${mailbox} status unavailable`);
  return status.messages ?? 0;
}
