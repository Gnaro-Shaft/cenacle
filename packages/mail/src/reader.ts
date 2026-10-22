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
import { imapOptions } from "./connection.ts";
import { toMailForModel } from "./mail-text.ts";
import { isMassMail, MASS_HEADERS } from "./mass-mail.ts";
import type { HeaderField } from "./ordered-headers.ts";
import { PostmanError } from "./postman.ts";
import { senderAddress, senderDomain } from "./sender-domain.ts";

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

/**
 * The raw sources, read-only, size-capped; in the order of `uids`, missing ones
 * skipped. The third element says whether the whole mail fit under the cap.
 */
async function readSources(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  expectedUidValidity: string | undefined,
): Promise<[number, Buffer, boolean][]> {
  if (uids.length === 0) return [];
  if (uids.length > MAX_MAILS_PER_READ) {
    throw new PostmanError(`at most ${MAX_MAILS_PER_READ} mails per read, got ${uids.length}`);
  }
  if (!uids.every((uid) => Number.isSafeInteger(uid) && uid > 0)) {
    throw new PostmanError("UIDs must be positive integers");
  }
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    const unseenBefore = await unseenCount(client, cadre.mailbox);
    const sources = new Map<number, { source: Buffer; complete: boolean }>();
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
      const query = { uid: true, size: true, source: { maxLength: MAX_SOURCE_BYTES } };
      for await (const msg of client.fetch(uids.join(","), query, { uid: true })) {
        if (msg.source === undefined) continue;
        // An unknown size is not a small one: only a size the server gave can prove it fits.
        const complete = typeof msg.size === "number" && msg.size <= MAX_SOURCE_BYTES;
        sources.set(msg.uid, { source: msg.source, complete });
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
    return uids.flatMap((uid) => {
      const read = sources.get(uid);
      return read === undefined
        ? []
        : [[uid, read.source, read.complete] as [number, Buffer, boolean]];
    });
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** A raw source, for an agent that parses it itself (ADR-0032). Never stored. */
export interface RawSource {
  readonly uid: number;
  readonly source: Buffer;
  /** False when the mail is larger than MAX_SOURCE_BYTES: the source is cut. */
  readonly complete: boolean;
}

export async function readRawSources(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  expectedUidValidity?: string,
): Promise<RawSource[]> {
  return (await readSources(cadre, password, uids, expectedUidValidity)).map(
    ([uid, source, complete]) => ({ uid, source, complete }),
  );
}

export async function readMailsForModel(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  /** When given, the mailbox must still have this UIDVALIDITY: otherwise the UIDs may name other mails. */
  expectedUidValidity?: string,
): Promise<MailForModel[]> {
  const mails: MailForModel[] = [];
  for (const [uid, source] of await readSources(cadre, password, uids, expectedUidValidity)) {
    mails.push(await parse(uid, source));
  }
  return mails;
}

/**
 * Mass mail (ADR-0029) from a raw source: its header block only, up to the
 * first empty line — a "List-Unsubscribe:" line in the body is text, not a
 * header. The same reading as the postman's: ordered fields, duplicates kept.
 */
export function massOfSource(source: Buffer): boolean {
  const raw = source.toString("latin1");
  const end = raw.search(/\r?\n\r?\n/);
  // Only the three mass headers, as the postman fetches only those it needs:
  // a mail with many other headers is read the same here and in production.
  const fields: HeaderField[] = [];
  for (const line of (end === -1 ? raw : raw.slice(0, end))
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (MASS_NAMES.has(name)) fields.push({ name, value: line.slice(colon + 1).trim() });
  }
  return isMassMail(fields);
}

const MASS_NAMES = new Set<string>(MASS_HEADERS);

/**
 * The sender's address from a raw source, for a [missions] rule (ADR-0031):
 * the header block only, exactly one From line (two are ambiguous: null), read
 * as strictly as the postman reads it. Kept in memory, never stored.
 */
export function senderOfSource(source: Buffer): string | null {
  const raw = source.toString("latin1");
  const end = raw.search(/\r?\n\r?\n/);
  const froms = (end === -1 ? raw : raw.slice(0, end))
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)
    .filter((line) => /^from\s*:/i.test(line));
  return froms.length === 1 ? senderAddress(froms[0]) : null;
}

/** What the sorting measure replays (mesure:rangement --simuler): the model's view and the mass flag. */
export interface MailForSorting {
  readonly view: MailForModel;
  readonly mass: boolean;
  /** The sender's address, for a [missions] rule only (ADR-0031); never shown to the model. */
  readonly address: string | null;
}

/** One read for both, from the same source: the simulation sees what production sees. */
export async function readMailsForSorting(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  expectedUidValidity?: string,
): Promise<MailForSorting[]> {
  const mails: MailForSorting[] = [];
  for (const [uid, source] of await readSources(cadre, password, uids, expectedUidValidity)) {
    mails.push({
      view: await parse(uid, source),
      mass: massOfSource(source),
      address: senderOfSource(source),
    });
  }
  return mails;
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
