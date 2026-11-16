/**
 * The reminders (ADR-0041, T-10): text I typed, a due instant, the instant it
 * rang. Set and cancelled from Telegram, rung by the bot — "ring, then
 * confirm" (Legion's ADR-017): a reminder is marked rung only after it was
 * sent, and only once. Erased for real: cancelled at once, rung ones after
 * the cadre's `rappels_jours`; one not yet rung is never purged.
 */
import type { Sql } from "postgres";

export interface Rappel {
  readonly id: number;
  readonly text: string;
  readonly due: Date;
  readonly setAt: Date;
  readonly rangAt: Date | null;
}

/** 1 to 300 characters, one line, no control character (the table holds the same). */
export const MAX_REMINDER_TEXT = 300;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
/** What shows nothing: format characters (zero widths, directions) and spaces. */
const INVISIBLE = /[\p{Cf}\p{Z}\s]/gu;

export class RappelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RappelError";
  }
}

/** The text as it is kept, or a RappelError saying why not. */
export function validReminderText(text: string): string {
  const t = text.trim();
  if (t.replace(INVISIBLE, "") === "") throw new RappelError("le texte du rappel est vide");
  // Characters as the table counts them, an emoji being one.
  if ([...t].length > MAX_REMINDER_TEXT) {
    throw new RappelError(`le texte dépasse ${MAX_REMINDER_TEXT} caractères`);
  }
  if (CONTROL.test(t))
    throw new RappelError("le texte tient sur une ligne, sans caractère spécial");
  return t;
}

export interface RappelStore {
  /** Sets a reminder; the text checked here and by the table. */
  add(text: string, due: Date): Promise<Rappel>;
  /** The reminders still to ring, soonest first, at most `limit`. */
  upcoming(limit: number): Promise<Rappel[]>;
  /** Erases a reminder still to ring; false when there is none by that number. */
  cancel(id: number): Promise<boolean>;
  /** The reminders due at `now` and not rung yet, oldest first, at most `limit`. */
  due(now: Date, limit: number): Promise<Rappel[]>;
  /** Marks it rung, once: false when it was rung already, or erased meanwhile. */
  markRang(id: number, at: Date): Promise<boolean>;
  /** Erases the reminders that rang before the cutoff; never one still to ring. */
  purge(cutoff: Date): Promise<number>;
}

interface Row {
  id: string | number;
  texte: string;
  echeance: Date;
  pose_le: Date;
  sonne_le: Date | null;
}

const fromRow = (r: Row): Rappel => ({
  id: Number(r.id),
  text: r.texte,
  due: r.echeance,
  setAt: r.pose_le,
  rangAt: r.sonne_le,
});

const limited = (n: number) => Math.max(1, Math.min(100, Math.floor(n)));

export function createRappelStore(sql: Sql): RappelStore {
  return {
    async add(text, due) {
      const [row] = await sql<Row[]>`
        insert into rappels (texte, echeance) values (${validReminderText(text)}, ${due})
        returning id, texte, echeance, pose_le, sonne_le`;
      if (row === undefined) throw new Error("the reminder was not kept");
      return fromRow(row);
    },
    async upcoming(limit) {
      const rows = await sql<Row[]>`
        select id, texte, echeance, pose_le, sonne_le from rappels
        where sonne_le is null order by echeance, id limit ${limited(limit)}`;
      return rows.map(fromRow);
    },
    async cancel(id) {
      if (!Number.isSafeInteger(id) || id <= 0) return false;
      const result = await sql`delete from rappels where id = ${id} and sonne_le is null`;
      return result.count === 1;
    },
    async due(now, limit) {
      const rows = await sql<Row[]>`
        select id, texte, echeance, pose_le, sonne_le from rappels
        where sonne_le is null and echeance <= ${now}
        order by echeance, id limit ${limited(limit)}`;
      return rows.map(fromRow);
    },
    async markRang(id, at) {
      // The Mac's clock and the database's are two clocks: never before it was set.
      const result = await sql`
        update rappels set sonne_le = greatest(${at}::timestamptz, pose_le)
        where id = ${id} and sonne_le is null`;
      return result.count === 1;
    },
    async purge(cutoff) {
      const result = await sql`delete from rappels where sonne_le < ${cutoff}`;
      return result.count;
    },
  };
}
