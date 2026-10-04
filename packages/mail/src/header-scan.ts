/**
 * Raw headers of every mail since a date (phase 5, M2), for the domain census
 * only: From of the inbox, To/Cc of Sent. Read-only like the postman: EXAMINE,
 * opened read-only or nothing is read, unread count checked before and after.
 * Headers only — never a subject nor a body.
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { imapOptions } from "./connection.ts";
import { PostmanError } from "./postman.ts";

const CHUNK = 500;

async function readBox(client: ImapFlow, mailbox: string, names: string[], since: Date) {
  const unseen = async () => {
    const s = await client.status(mailbox, { unseen: true });
    if (s === false || typeof s.unseen !== "number") {
      throw new PostmanError(`${mailbox}: unread count unavailable`);
    }
    return s.unseen;
  };
  const before = await unseen();
  const blocks: string[] = [];
  const lock = await client.getMailboxLock(mailbox, { readOnly: true });
  try {
    if (client.mailbox === false || !client.mailbox.readOnly) {
      throw new PostmanError(`${mailbox} was not opened read-only — refusing to read`);
    }
    const found = await client.search({ since }, { uid: true });
    const uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b);
    for (let i = 0; i < uids.length; i += CHUNK) {
      const range = uids.slice(i, i + CHUNK).join(",");
      for await (const msg of client.fetch(range, { uid: true, headers: names }, { uid: true })) {
        blocks.push(msg.headers?.toString("utf8") ?? "");
      }
    }
  } finally {
    lock.release();
  }
  const after = await unseen();
  if (after !== before) {
    throw new PostmanError(`unread count changed during a read-only pass (${before} → ${after})`);
  }
  return blocks;
}

export async function headersSince(
  cadre: MailCadre,
  password: string,
  since: Date,
): Promise<{ inbox: string[]; sent: string[] }> {
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    return {
      inbox: await readBox(client, cadre.mailbox, ["from"], since),
      sent: await readBox(client, cadre.sentMailbox, ["to", "cc"], since),
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
