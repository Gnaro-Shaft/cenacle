/**
 * The reader: fetches the content of the given mails, for the model only.
 *
 * Same read-only guarantees as the postman (EXAMINE + BODY.PEEK, unread count
 * checked before and after). The content lives in memory, is never stored,
 * and each message is fetched with a size cap.
 */
import type { MailForModel } from "@cenacle/core";
import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import type { MailCadre } from "./cadre.ts";
import { toMailForModel } from "./mail-text.ts";
import { PostmanError } from "./postman.ts";
import { senderDomain } from "./sender-domain.ts";

/** Bytes read per message at most: enough for the text, never the attachments. */
export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_MAILS_PER_READ = 500;

async function unseenCount(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { unseen: true });
  if (status === false || typeof status.unseen !== "number") {
    throw new PostmanError(`${mailbox}: unread count unavailable`);
  }
  return status.unseen;
}

async function parse(uid: number, source: Buffer): Promise<MailForModel> {
  try {
    const email = await PostalMime.parse(source, { maxNestingDepth: 20 });
    const fromHeader = email.headers.find((h) => h.key === "from")?.value;
    return toMailForModel({
      uid,
      fromName: email.from?.name,
      domain: senderDomain(fromHeader),
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch {
    // A message that cannot be parsed is shown to the model as empty: it will
    // land in "À trier" rather than stop the whole pass.
    return toMailForModel({ uid, fromName: "", domain: null, subject: "", text: "", html: "" });
  }
}

export async function readMailsForModel(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  /** When given, the mailbox must still have this UIDVALIDITY: otherwise the UIDs may name other mails. */
  expectedUidValidity?: string,
): Promise<MailForModel[]> {
  if (uids.length === 0) return [];
  if (uids.length > MAX_MAILS_PER_READ) {
    throw new PostmanError(`at most ${MAX_MAILS_PER_READ} mails per read, got ${uids.length}`);
  }
  if (!uids.every((uid) => Number.isSafeInteger(uid) && uid > 0)) {
    throw new PostmanError("UIDs must be positive integers");
  }
  const client = new ImapFlow({
    host: cadre.host,
    port: cadre.port,
    secure: false, // loopback test mailbox only (cadre refuses any other host); TLS in phase 5
    auth: { user: cadre.user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const unseenBefore = await unseenCount(client, cadre.mailbox);
    const sources = new Map<number, Buffer>();
    const lock = await client.getMailboxLock(cadre.mailbox, { readOnly: true });
    try {
      if (client.mailbox === false || !client.mailbox.readOnly) {
        throw new PostmanError(`${cadre.mailbox} was not opened read-only — refusing to read`);
      }
      const current = String(client.mailbox.uidValidity);
      if (expectedUidValidity !== undefined && current !== expectedUidValidity) {
        throw new PostmanError(
          `${cadre.mailbox} was renumbered (UIDVALIDITY ${expectedUidValidity} → ${current}): the stored UIDs no longer name the same mails — run mail:sort again first`,
        );
      }
      const query = { uid: true, source: { maxLength: MAX_SOURCE_BYTES } };
      for await (const msg of client.fetch(uids.join(","), query, { uid: true })) {
        if (msg.source !== undefined) sources.set(msg.uid, msg.source);
      }
    } finally {
      lock.release();
    }
    const unseen = await unseenCount(client, cadre.mailbox);
    if (unseen !== unseenBefore) {
      throw new PostmanError(
        `unread count changed during a read-only pass (${unseenBefore} → ${unseen})`,
      );
    }
    const mails: MailForModel[] = [];
    for (const uid of uids) {
      const source = sources.get(uid);
      if (source !== undefined) mails.push(await parse(uid, source));
    }
    return mails;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export interface FixtureLike {
  readonly from: { readonly name: string; readonly address: string };
  readonly subject: string;
  readonly contentType: string;
  readonly body: string;
}

/** The same view built straight from a fixture, for the benchmark. */
export function fixtureForModel(uid: number, fixture: FixtureLike): MailForModel {
  const html = fixture.contentType === "text/html";
  return toMailForModel({
    uid,
    fromName: fixture.from.name,
    domain: senderDomain(`From: <${fixture.from.address}>`),
    subject: fixture.subject,
    text: html ? undefined : fixture.body,
    html: html ? fixture.body : undefined,
  });
}
