// Iris reads every folder (ADR-0016): a mail I move keeps everything Iris
// knows of it; a forged Message-ID never takes another mail's place; a copy
// is remembered once; a mail moved where Iris does not read is forgotten;
// a failed pass commits nothing; folder names never reach the journal.
import { describe, expect, it } from "vitest";
import { type CollectDeps, collectMail } from "./collect.ts";
import { readableFolders } from "./folders.ts";
import { createKeyer } from "./keys.ts";
import type { FetchResult, MailRef } from "./postman.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { memoryLocationStore } from "./test-locations.ts";

const keyer = createKeyer("7".repeat(64));
const K = (c: string) => c.repeat(64).slice(0, 64);
const NOW = new Date("2026-10-06T12:00:00.000Z");
const mail = (uid: number, id: string, over: Partial<MailRef> = {}): MailRef => ({
  uid,
  domain: "client.example",
  senderKey: K("a"),
  messageKey: K(id),
  threadKeys: [],
  receivedAt: "2026-10-06T08:00:00.000Z",
  urgentTerm: false,
  auth: "authenticated",
  ...over,
});

/** A fake server: folders by path, each with its UIDVALIDITY and its mails. */
function server(initial: Record<string, { validity: string; mails: MailRef[] }>) {
  const boxes = structuredClone(initial);
  const asked: string[] = [];
  let broken: string | null = null;
  const fetchFolder = async (path: string, afterUid: number): Promise<FetchResult<MailRef>> => {
    asked.push(`${path}>${afterUid}`);
    if (path === broken) throw new Error("IMAP down");
    const box = boxes[path] ?? { validity: "1", mails: [] };
    const refs = box.mails.filter((m) => m.uid > afterUid).sort((a, b) => a.uid - b.uid);
    return {
      refs,
      uidValidity: box.validity,
      present: box.mails.map((m) => m.uid),
      available: refs.length,
      truncated: false,
      lastUid: refs.at(-1)?.uid ?? null,
      unseen: 0,
    };
  };
  /** I move a mail: it gets the next UID of the target folder. */
  const move = (from: string, uid: number, to: string) => {
    const src = boxes[from];
    const dst = boxes[to];
    if (src === undefined || dst === undefined) throw new Error("no such folder");
    const m = src.mails.find((x) => x.uid === uid);
    if (m === undefined) throw new Error("no such mail");
    src.mails = src.mails.filter((x) => x !== m);
    const next = Math.max(0, ...dst.mails.map((x) => x.uid)) + 1;
    dst.mails.push({ ...m, uid: next });
  };
  return {
    boxes,
    asked,
    fetchFolder,
    move,
    breakOn: (p: string | null) => {
      broken = p;
    },
  };
}

function iris(srv: ReturnType<typeof server>, read = ["INBOX", "Clients"]) {
  const journal = memoryJournal();
  const store = memoryMailStore();
  const locations = memoryLocationStore();
  const deps: CollectDeps = {
    journal,
    store,
    rules: new Map([["client.example", "clients_prospects"]]),
    retentionDays: 90,
    opposedKeys: new Set(),
    notBefore: new Date("2026-10-04T00:00:00.000Z"),
    clock: () => NOW,
    folders: async () => read.map((path) => ({ path, key: keyer.folder(path) })),
    fetchFolder: srv.fetchFolder,
    locations,
    fetchSent: async () => ({
      refs: [],
      uidValidity: "1",
      present: [],
      available: 0,
      truncated: false,
      lastUid: null,
      unseen: 0,
    }),
  };
  return { journal, store, locations, deps };
}

describe("which folders", () => {
  it("every folder but Sent, Trash, Junk, Drafts, virtual and unselectable ones; known by key", () => {
    const folders = readableFolders(
      [
        { path: "INBOX", specialUse: "\\Inbox" },
        { path: "Clients" },
        { path: "Clients/Dupont" },
        { path: "Sent", specialUse: "\\Sent" },
        { path: "Envoyés" },
        { path: "Trash", specialUse: "\\Trash" },
        { path: "Spam", specialUse: "\\Junk" },
        { path: "Drafts", specialUse: "\\Drafts" },
        { path: "All Mail", specialUse: "\\All" },
        { path: "Starred", specialUse: "\\Flagged" },
        { path: "Archive", specialUse: "\\Archive" },
        { path: "Parent", flags: new Set(["\\Noselect"]) },
      ],
      "Envoyés",
      keyer,
    );
    expect(folders.map((f) => f.path)).toEqual(["INBOX", "Clients", "Clients/Dupont", "Archive"]);
    expect(folders.every((f) => /^[0-9a-f]{64}$/.test(f.key) && !f.key.includes(f.path))).toBe(
      true,
    );
    expect(new Set(folders.map((f) => f.key)).size).toBe(4);
  });

  it("too many folders: refused, not guessed", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ path: `F${i}` }));
    expect(() => readableFolders(many, "Sent", keyer)).toThrow(/more than 200/);
  });
});

describe("a mail I move keeps what Iris knows of it", () => {
  it("same id, category and verdict; not sorted again; counted as moved", async () => {
    const srv = server({
      INBOX: { validity: "7", mails: [mail(1, "m")] },
      Clients: { validity: "7", mails: [] },
    });
    const w = iris(srv);
    await collectMail(w.deps);
    const [before] = await w.store.inbox();
    srv.move("INBOX", 1, "Clients");
    const second = await collectMail(w.deps);
    const after = await w.store.inbox();
    expect(after).toEqual([before]);
    expect(second.count).toBe(0);
    expect(second.purged).toBe(0);
    const fetched = w.journal.events.filter((e) => e.type === "mail.fetched").at(-1)?.payload;
    expect(fetched).toMatchObject({ count: 0, moved: 1, copies: 0 });
  });

  it("a mail arriving straight in a folder is read too", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [] },
      Clients: { validity: "1", mails: [mail(9, "n")] },
    });
    const w = iris(srv);
    expect((await collectMail(w.deps)).count).toBe(1);
  });

  it("moved to a folder Iris does not read (Trash): forgotten", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      Clients: { validity: "1", mails: [] },
      Trash: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    await collectMail(w.deps);
    srv.move("INBOX", 1, "Trash");
    const second = await collectMail(w.deps);
    expect(await w.store.inbox()).toEqual([]);
    expect(second.purged).toBe(1);
    expect(await w.locations.all()).toEqual([]);
  });

  it("same UIDVALIDITY and UID in two folders: two different mails", async () => {
    const srv = server({
      INBOX: { validity: "5", mails: [mail(1, "m")] },
      Clients: { validity: "5", mails: [mail(1, "n")] },
    });
    const w = iris(srv);
    expect((await collectMail(w.deps)).count).toBe(2);
  });
});

describe("a forged Message-ID never takes another mail's place", () => {
  it.each([
    ["another sender", { senderKey: K("e") }],
    ["another arrival time", { receivedAt: "2026-10-06T09:00:00.000Z" }],
    ["an unreadable sender", { senderKey: null }],
  ])("same Message-ID, %s: a new mail; the original, gone, is forgotten", async (_l, forged) => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      Clients: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    await collectMail(w.deps);
    const [original] = await w.store.inbox();
    srv.boxes.INBOX = { validity: "1", mails: [] };
    srv.boxes.Clients = { validity: "1", mails: [mail(5, "m", forged)] };
    await collectMail(w.deps);
    const now = await w.store.inbox();
    expect(now).toHaveLength(1);
    expect(now[0]?.uid).not.toBe(original?.uid);
  });

  it("a copy of a mail still in its place is remembered once", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      Clients: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    await collectMail(w.deps);
    srv.boxes.Clients = { validity: "1", mails: [mail(3, "m")] };
    await collectMail(w.deps);
    expect(await w.store.inbox()).toHaveLength(1);
    const fetched = w.journal.events.filter((e) => e.type === "mail.fetched").at(-1)?.payload;
    expect(fetched).toMatchObject({ copies: 1, count: 0 });
  });
});

describe("cursors, failures and the journal", () => {
  it("old mails (before the notice) are looked at once, never fetched again", async () => {
    const old = { receivedAt: "2026-09-01T08:00:00.000Z" };
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "o", old), mail(2, "p", old)] },
      Clients: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    await collectMail(w.deps);
    await collectMail(w.deps);
    expect(srv.asked.filter((a) => a.startsWith("INBOX"))).toEqual(["INBOX>0", "INBOX>2"]);
    expect(await w.store.inbox()).toEqual([]);
  });

  it("a pass failing on a folder commits no cursor: the same mails are read again", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      Clients: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    srv.breakOn("Clients");
    await expect(collectMail(w.deps)).rejects.toThrow("IMAP down");
    srv.breakOn(null);
    expect((await collectMail(w.deps)).count).toBe(1);
    expect(srv.asked.filter((a) => a.startsWith("INBOX"))).toEqual(["INBOX>0", "INBOX>0"]);
  });

  it("a location left by a failed save is dropped, and its mail saved at the next pass", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      Clients: { validity: "1", mails: [] },
    });
    const w = iris(srv);
    await w.locations.add({ folderKey: keyer.folder("INBOX"), uidValidity: "1", uid: 1 }, K("m"));
    expect((await collectMail(w.deps)).count).toBe(1);
    expect(await w.store.inbox()).toHaveLength(1);
  });

  it("folder names and keys never reach the journal", async () => {
    const srv = server({
      INBOX: { validity: "1", mails: [mail(1, "m")] },
      "Clients/Dupont SA": { validity: "1", mails: [] },
    });
    const w = iris(srv, ["INBOX", "Clients/Dupont SA"]);
    await collectMail(w.deps);
    const all = JSON.stringify(w.journal.events.map((e) => [e.type, e.payload]));
    expect(all).not.toMatch(/Dupont|INBOX/);
    expect(all).not.toContain(keyer.folder("INBOX"));
  });
});
