/**
 * The journal: append and read events (ADR-0008).
 *
 * Inputs are validated here AND by the database; the database is the
 * last word. Nothing in this module can change or remove an event.
 */
import type { Sql } from "postgres";

const AGENT_RULE = /^[a-z][a-z0-9_-]{0,31}$/;
const TYPE_RULE = /^[a-z][a-z0-9_.]{0,63}$/;
/** Events carry facts, not content: a large payload is a design smell. */
export const MAX_PAYLOAD_BYTES = 4096;
const MAX_READ_LIMIT = 1000;

export type Payload = Record<string, unknown>;

export interface NewEvent {
  readonly agent: string;
  readonly type: string;
  readonly payload?: Payload;
}

export interface StoredEvent {
  readonly id: bigint;
  readonly occurredAt: Date;
  readonly agent: string;
  readonly type: string;
  readonly payload: Payload;
}

export interface ReadOptions {
  readonly agent?: string;
  /** Only events with an id strictly greater than this one. */
  readonly afterId?: bigint;
  readonly limit?: number;
}

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

function isPlainObject(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validate(event: NewEvent): Payload {
  if (typeof event.agent !== "string" || !AGENT_RULE.test(event.agent)) {
    throw new InvalidEventError(`Invalid agent name: ${JSON.stringify(event.agent)}`);
  }
  if (typeof event.type !== "string" || !TYPE_RULE.test(event.type)) {
    throw new InvalidEventError(`Invalid event type: ${JSON.stringify(event.type)}`);
  }
  // Only a missing payload defaults to {}; an explicit null is a caller bug.
  const payload = event.payload === undefined ? {} : event.payload;
  if (!isPlainObject(payload)) {
    throw new InvalidEventError("Payload must be a plain object");
  }
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (size > MAX_PAYLOAD_BYTES) {
    throw new InvalidEventError(`Payload too large: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`);
  }
  return payload;
}

interface Row {
  id: string;
  occurred_at: Date;
  agent: string;
  type: string;
  payload: Payload;
}

const toStored = (row: Row): StoredEvent => ({
  id: BigInt(row.id),
  occurredAt: row.occurred_at,
  agent: row.agent,
  type: row.type,
  payload: row.payload,
});

export interface Journal {
  append(event: NewEvent): Promise<StoredEvent>;
  read(options?: ReadOptions): Promise<StoredEvent[]>;
}

export function createJournal(sql: Sql): Journal {
  return {
    async append(event) {
      const payload = validate(event);
      const rows = await sql<Row[]>`
        insert into events (agent, type, payload)
        values (${event.agent}, ${event.type}, ${sql.json(payload as never)})
        returning id::text, occurred_at, agent, type, payload`;
      const row = rows[0];
      if (row === undefined) throw new Error("Insert returned no row");
      return toStored(row);
    },

    async read(options = {}) {
      const limit = options.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_READ_LIMIT) {
        throw new InvalidEventError(`limit must be an integer between 1 and ${MAX_READ_LIMIT}`);
      }
      if (options.agent !== undefined && !AGENT_RULE.test(options.agent)) {
        throw new InvalidEventError(`Invalid agent name: ${JSON.stringify(options.agent)}`);
      }
      const after = (options.afterId ?? 0n).toString();
      const rows = await sql<Row[]>`
        select id::text, occurred_at, agent, type, payload
        from events
        where id > ${after}::bigint
          ${options.agent === undefined ? sql`` : sql`and agent = ${options.agent}`}
        order by events.id
        limit ${limit}`;
      return rows.map(toStored);
    },
  };
}

/** Reads every event of an agent, oldest first, page by page. */
export async function readAllEvents(journal: Journal, agent: string): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  let afterId = 0n;
  for (;;) {
    const page = await journal.read({ agent, afterId, limit: MAX_READ_LIMIT });
    events.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < MAX_READ_LIMIT) return events;
    afterId = last.id;
  }
}
