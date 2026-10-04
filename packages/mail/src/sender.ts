/**
 * Builds and sends one reply (phase 4, B4). Used by the executor only.
 *
 * - One recipient, given in the SMTP envelope: no Cc, no Bcc, whatever the
 *   text holds. In phase 4 it must be on a reserved test domain (RFC 2606):
 *   nobody real can receive anything.
 * - Plain text only; the subject and thread ids come from the server, cleaned.
 * - The server is the loopback test server of the cadre (refused otherwise).
 * - A copy goes to my Sent folder, marked read: Iris then sees I answered.
 * - A header says, for machines, that the reply was prepared with a local AI
 *   and reviewed and accepted by its sender (AI Act transparency; the
 *   information notice says it to people).
 */
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { type MailCadre, TEST_DOMAIN } from "./cadre.ts";
import { imapOptions, smtpOptions } from "./connection.ts";
import { type ReplyContext, safeAddress, validMessageId } from "./reply-target.ts";

export class SendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendError";
  }
}

const MAX_SUBJECT = 200;
/** Machine-readable mark of AI assistance (decided 04/10, C4). Fixed: nothing of the mail goes in it. */
export const AI_ASSISTED_HEADER = "X-AI-Assisted";
export const AI_ASSISTED_VALUE = "draft-by-local-model; reviewed-and-accepted-by-sender";

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

/**
 * The recipient, re-checked here: one plain address, and either on my closed
 * list ([envoi] destinataires of a real box, M1-M2) or, for the fictional box
 * (null), on a reserved test domain.
 */
export function allowedRecipient(
  to: string | null,
  recipients: readonly string[] | null = null,
): string {
  const address = safeAddress(to ?? undefined);
  if (address === null) throw new SendError("no readable recipient");
  if (recipients === null) {
    if (!TEST_DOMAIN.test(address)) {
      throw new SendError("the fictional box sends to test domains only (.test, .example)");
    }
  } else if (!recipients.includes(address.toLowerCase())) {
    throw new SendError("not on the closed list of recipients ([envoi] destinataires)");
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
  /** [envoi] destinataires of the box; null (the default) allows reserved test domains only. */
  recipients: readonly string[] | null = null,
): Promise<BuiltReply> {
  const to = allowedRecipient(context.to, recipients);
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
    headers: { [AI_ASSISTED_HEADER]: AI_ASSISTED_VALUE },
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
  const transport = createTransport(smtpOptions(cadre, password));
  try {
    await transport.sendMail({ envelope: { from: cadre.address, to: [reply.to] }, raw: reply.raw });
  } finally {
    transport.close();
  }
}

/** The executor's only write to the mailbox: a copy in Sent, marked read. */
export async function copyToSent(cadre: MailCadre, password: string, raw: Buffer): Promise<void> {
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    await client.append(cadre.sentMailbox, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
