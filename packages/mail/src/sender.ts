/**
 * Builds and sends one reply (phase 4, B4). Used by the executor only.
 *
 * - One recipient, given in the SMTP envelope: no Cc, no Bcc, whatever the
 *   text holds. In phase 4 it must be on a reserved test domain (RFC 2606):
 *   nobody real can receive anything.
 * - Plain text only; the subject and thread ids come from the server, cleaned.
 * - The server is the loopback test server of the cadre (refused otherwise).
 * - A copy goes to my Sent folder, marked read: Iris then sees I answered.
 */
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { type MailCadre, TEST_DOMAIN } from "./cadre.ts";
import { type ReplyContext, safeAddress, validMessageId } from "./reply-target.ts";

export class SendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendError";
  }
}

const MAX_SUBJECT = 200;

/** Control characters (CR, LF, NUL…) become spaces: a subject is one header line. */
function withoutControls(text: string): string {
  return [...text]
    .map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c))
    .join("");
}

/** "Re: <subject>", control characters removed, bounded. */
export function replySubject(subject: string): string {
  const clean = withoutControls(subject).replace(/\s+/g, " ").trim();
  const base = /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
  return base.slice(0, MAX_SUBJECT);
}

/** The recipient, re-checked here: one plain address, on a test domain in phase 4. */
export function allowedRecipient(to: string | null): string {
  const address = safeAddress(to ?? undefined);
  if (address === null) throw new SendError("no readable recipient");
  if (!TEST_DOMAIN.test(address)) {
    throw new SendError("phase 4 sends to test domains only (.test, .example)");
  }
  return address;
}

export interface BuiltReply {
  readonly to: string;
  readonly raw: Buffer;
}

export async function buildReply(
  from: string,
  context: ReplyContext,
  text: string,
  date: Date,
): Promise<BuiltReply> {
  const to = allowedRecipient(context.to);
  const parent = validMessageId(context.messageId);
  const references = [...context.references, ...(parent === null ? [] : [parent])].slice(-20);
  const domain = from.slice(from.lastIndexOf("@") + 1);
  const raw = await new MailComposer({
    from,
    to,
    subject: replySubject(context.subject),
    text,
    date,
    messageId: `<${randomUUID()}@${domain}>`,
    ...(parent === null ? {} : { inReplyTo: parent }),
    ...(references.length === 0 ? {} : { references }),
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
  return { to, raw };
}

export async function sendReply(
  cadre: MailCadre,
  password: string,
  reply: BuiltReply,
): Promise<void> {
  const transport = createTransport({
    host: cadre.host, // loopback only: the cadre refuses any other host
    port: cadre.smtpPort,
    secure: false,
    ignoreTLS: true, // loopback test server; TLS in phase 5
    auth: { user: cadre.user, pass: password },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ envelope: { from: cadre.address, to: [reply.to] }, raw: reply.raw });
  } finally {
    transport.close();
  }
}

/** The executor's only write to the mailbox: a copy in Sent, marked read. */
export async function copyToSent(cadre: MailCadre, password: string, raw: Buffer): Promise<void> {
  const client = new ImapFlow({
    host: cadre.host,
    port: cadre.port,
    secure: false,
    auth: { user: cadre.user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    await client.append(cadre.sentMailbox, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
