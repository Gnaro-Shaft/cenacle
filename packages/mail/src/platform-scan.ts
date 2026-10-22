/**
 * The sources of the mails some platforms sent since a date, for the
 * prospection survey only (npm run prospection:releve): to fill
 * prospection.local.toml with their exact alert addresses and link hosts.
 * Read-only like the postman: opened read-only or nothing is read, unread
 * count checked before and after, each source size-capped. Never stored.
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { imapOptions } from "./connection.ts";
import { PostmanError } from "./postman.ts";
import { MAX_SOURCE_BYTES, senderOfSource } from "./reader.ts";

/** Mails read per platform word and folder at most: a survey, not a census. */
export const SURVEY_MAX_PER_SEARCH = 50;
const CHUNK = 500;

async function readFolder(
  client: ImapFlow,
  path: string,
  words: readonly string[],
  since: Date,
): Promise<Buffer[]> {
  const unseen = async () => {
    const s = await client.status(path, { unseen: true });
    if (s === false || typeof s.unseen !== "number") {
      throw new PostmanError(`${path}: unread count unavailable`);
    }
    return s.unseen;
  };
  const before = await unseen();
  const sources: Buffer[] = [];
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    if (client.mailbox === false || !client.mailbox.readOnly) {
      throw new PostmanError(`${path} was not opened read-only — refusing to read`);
    }
    // The From header of every mail of the period, matched here: a server's
    // FROM search is a substring on some servers, the whole address on others.
    const found = await client.search({ since }, { uid: true });
    const uids = Array.isArray(found) ? found : [];
    const byWord = new Map<string, number[]>(words.map((w) => [w, []]));
    for (let i = 0; i < uids.length; i += CHUNK) {
      const range = uids.slice(i, i + CHUNK).join(",");
      for await (const msg of client.fetch(
        range,
        { uid: true, headers: ["from"] },
        { uid: true },
      )) {
        const domain = senderOfSource(msg.headers ?? Buffer.alloc(0))?.split("@")[1];
        const word = domain === undefined ? undefined : words.find((w) => domain.includes(w));
        if (word !== undefined) byWord.get(word)?.push(msg.uid);
      }
    }
    const chosen = [...byWord.values()].flatMap((list) =>
      list.sort((a, b) => b - a).slice(0, SURVEY_MAX_PER_SEARCH),
    );
    if (chosen.length > 0) {
      const query = { uid: true, source: { maxLength: MAX_SOURCE_BYTES } };
      for await (const msg of client.fetch(chosen.join(","), query, { uid: true })) {
        if (msg.source !== undefined) sources.push(msg.source);
      }
    }
  } finally {
    lock.release();
  }
  const after = await unseen();
  if (after !== before) {
    throw new PostmanError(`unread count changed during a read-only pass (${before} → ${after})`);
  }
  return sources;
}

export async function platformSourcesSince(
  cadre: MailCadre,
  password: string,
  folders: readonly string[],
  since: Date,
  words: readonly string[],
): Promise<Buffer[]> {
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    const all: Buffer[] = [];
    for (const path of folders) all.push(...(await readFolder(client, path, words, since)));
    return all;
  } finally {
    await client.logout().catch(() => client.close());
  }
}
