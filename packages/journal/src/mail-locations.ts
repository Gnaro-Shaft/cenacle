/**
 * Where each remembered mail is on the server, and how far each folder was
 * read (ADR-0016). A received mail keeps the id Iris gave it (mail_items.uid
 * under VIRTUAL_UID_VALIDITY) when I move it; only its location changes.
 * Folders are known by their HMAC key, never by name.
 */
import type { Sql } from "postgres";

/** The UIDVALIDITY of Iris's own numbering of received mails: never a server's. */
export const VIRTUAL_UID_VALIDITY = "0";

export interface Location {
  readonly folderKey: string;
  readonly uidValidity: string;
  readonly uid: number;
}

export interface LocatedMail extends Location {
  /** Iris's id of the mail: mail_items.uid of its 'inbox' row. */
  readonly id: number;
  readonly messageKey: string | null;
}

export interface FolderCursor {
  readonly uidValidity: string;
  readonly lastUid: number;
}

export interface LocationStore {
  cursor(folderKey: string): Promise<FolderCursor | null>;
  setCursor(folderKey: string, cursor: FolderCursor): Promise<void>;
  /** Folders gone from the server: their cursors are dropped. Returns how many. */
  keepCursors(folderKeys: readonly string[]): Promise<number>;
  all(): Promise<LocatedMail[]>;
  locate(ids: readonly number[]): Promise<Map<number, LocatedMail>>;
  /** A new mail: its id, never reused. */
  add(location: Location, messageKey: string | null): Promise<number>;
  /** The same mail, found elsewhere (moved, or its folder renumbered). */
  move(id: number, location: Location): Promise<void>;
  /** Locations of mails no longer remembered. Returns how many were dropped. */
  keepOnly(ids: readonly number[]): Promise<number>;
}

interface Row {
  id: string;
  folder_key: string;
  uid_validity: string;
  uid: string;
  message_key: string | null;
}

const toLocated = (r: Row): LocatedMail => ({
  id: Number(r.id),
  folderKey: r.folder_key,
  uidValidity: r.uid_validity,
  uid: Number(r.uid),
  messageKey: r.message_key,
});

export function createLocationStore(sql: Sql): LocationStore {
  return {
    async cursor(folderKey) {
      const [row] = await sql<{ uid_validity: string; last_uid: string }[]>`
        select uid_validity, last_uid::text from mail_folders where folder_key = ${folderKey}`;
      return row === undefined
        ? null
        : { uidValidity: row.uid_validity, lastUid: Number(row.last_uid) };
    },

    async setCursor(folderKey, cursor) {
      await sql`
        insert into mail_folders (folder_key, uid_validity, last_uid)
        values (${folderKey}, ${cursor.uidValidity}, ${cursor.lastUid})
        on conflict (folder_key) do update
          set uid_validity = excluded.uid_validity, last_uid = excluded.last_uid`;
    },

    async keepCursors(folderKeys) {
      return (
        await sql`delete from mail_folders where not (folder_key = any(${sql.array([...folderKeys])}))`
      ).count;
    },

    async all() {
      return (
        await sql<Row[]>`
          select id::text, folder_key, uid_validity, uid::text, message_key
          from mail_locations order by id`
      ).map(toLocated);
    },

    async locate(ids) {
      if (ids.length === 0) return new Map();
      const rows = await sql<Row[]>`
        select id::text, folder_key, uid_validity, uid::text, message_key from mail_locations
        where id = any(${sql.array(ids.map(String))}::bigint[])`;
      return new Map(rows.map((r) => [Number(r.id), toLocated(r)]));
    },

    async add(location, messageKey) {
      const [row] = await sql<{ id: string }[]>`
        insert into mail_locations (folder_key, uid_validity, uid, message_key)
        values (${location.folderKey}, ${location.uidValidity}, ${location.uid}, ${messageKey})
        returning id::text`;
      if (row === undefined) throw new Error("mail_locations: insert returned nothing");
      return Number(row.id);
    },

    async move(id, location) {
      const result = await sql`
        update mail_locations
        set folder_key = ${location.folderKey}, uid_validity = ${location.uidValidity}, uid = ${location.uid}
        where id = ${id}`;
      if (result.count !== 1) throw new Error(`mail_locations: no mail ${id} to move`);
    },

    async keepOnly(ids) {
      return (
        await sql`
          delete from mail_locations
          where not (id = any(${sql.array(ids.map(String))}::bigint[]))`
      ).count;
    },
  };
}
