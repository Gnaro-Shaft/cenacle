/**
 * Builds a raw RFC 822 message from a fixture, to load the test mailbox.
 * Headers are ASCII (RFC 2047 encoded-words for UTF-8), the body is base64.
 */
import { type FixtureMessage, type FixtureSentMessage, fixtureMessageId } from "@cenacle/core";

function encodeWord(text: string): string {
  // Plain ASCII without specials can stay as is; anything else is encoded.
  const printableAscii = [...text].every((c) => c >= " " && c <= "~");
  if (printableAscii && !text.includes("=?")) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** A display name with RFC 5322 specials, e.g. "(fictive)", must be quoted or it reads as a comment. */
function displayName(name: string): string {
  const encoded = encodeWord(name);
  if (encoded !== name || !/[()<>[\]:;@\\,."]/.test(name)) return encoded;
  return `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * The fictional receiving server of the test mailbox (cadre.toml authserv_id):
 * every incoming fixture carries its verdict, on top — GreenMail adds no
 * Received header, so cadre.toml expects it with none above (rang_attendu 0).
 */
export const FIXTURE_AUTHSERV_ID = "mx.cenacle.test";

function wrap76(base64: string): string {
  return base64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`Header injection attempt in ${field}`);
}

interface RawMessage {
  readonly id: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly to: string;
  readonly subject: string;
  readonly date: string;
  readonly contentType: string;
  readonly body: string;
  /** Fixture ids of the thread, oldest first; the last one is the direct parent. */
  readonly references: readonly string[];
  /** Incoming mails only: our fictional server says the From domain passed DMARC. */
  readonly authenticated: boolean;
}

function build(message: RawMessage): Buffer {
  for (const [field, value] of [
    ["From name", message.fromName],
    ["From address", message.fromAddress],
    ["To", message.to],
    ["Subject", message.subject],
    ...message.references.map((ref) => ["References", ref] as const),
  ] as const) {
    assertHeaderSafe(value, field);
  }
  const thread =
    message.references.length === 0
      ? []
      : [
          `In-Reply-To: ${fixtureMessageId(message.references.at(-1) ?? "")}`,
          `References: ${message.references.map(fixtureMessageId).join(" ")}`,
        ];
  const domain = message.fromAddress.split("@").at(-1)?.toLowerCase() ?? "";
  const verdict = message.authenticated
    ? [`Authentication-Results: ${FIXTURE_AUTHSERV_ID}; dmarc=pass header.from=${domain}`]
    : [];
  const headers = [
    ...verdict,
    `From: ${displayName(message.fromName)} <${message.fromAddress}>`,
    `To: <${message.to}>`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${new Date(message.date).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${fixtureMessageId(message.id)}`,
    ...thread,
    "MIME-Version: 1.0",
    `Content-Type: ${message.contentType}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap76(Buffer.from(message.body, "utf8").toString("base64"));
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`, "ascii");
}

/**
 * An incoming fixture. `sent` is needed only when it replies to one of my
 * sent mails, to rebuild the thread's References.
 */
export function toRfc822(
  message: FixtureMessage,
  sent: readonly FixtureSentMessage[] = [],
): Buffer {
  let references: readonly string[] = [];
  if (message.inReplyTo !== null) {
    const parent = sent.find((s) => s.id === message.inReplyTo);
    if (parent === undefined)
      throw new Error(`${message.id} replies to unknown sent mail ${message.inReplyTo}`);
    references = [...parent.references, parent.id];
  }
  return build({
    id: message.id,
    fromName: message.from.name,
    fromAddress: message.from.address,
    to: message.to,
    subject: message.subject,
    date: message.date,
    contentType: message.contentType,
    body: message.body,
    references,
    authenticated: true,
  });
}

/** One of my sent mails, as stored in the Sent folder. */
export function sentToRfc822(message: FixtureSentMessage, from: string): Buffer {
  return build({
    id: message.id,
    fromName: "Propriétaire (fictif)",
    fromAddress: from,
    to: message.to,
    subject: message.subject,
    date: message.date,
    contentType: "text/plain",
    body: message.body,
    references: message.references,
    authenticated: false,
  });
}
