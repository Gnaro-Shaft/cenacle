/**
 * The board of missions, for the page (ADR-0032, points 15 to 20): the cards
 * as plain JSON, a card I typed, and my moves. The server is the only writer
 * of a move and of a card by hand; the agent only adds what it extracted.
 * The journal gets columns and numbers, never which card nor its text.
 */
import type { Card, NewCard, ProspectionStore } from "@cenacle/journal";
import {
  AGENT_COLUMNS,
  cardByHand,
  MY_COLUMNS,
  type ProspectionConfig,
  ProspectionConfigError,
  shownLink,
} from "@cenacle/prospection";

export const ALL_COLUMNS: readonly string[] = [...AGENT_COLUMNS, ...MY_COLUMNS];

/** A refusal the page may show as is: written by the code, never by a card. */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

export interface CardView {
  readonly id: number;
  /** "mail": extracted by AI from a platform's alert; "me": typed by me. */
  readonly source: "mail" | "me";
  readonly platform: string | null;
  readonly title: string;
  readonly company: string | null;
  readonly intermediary: string;
  readonly stack: readonly string[];
  readonly rate: readonly [number, number] | null;
  readonly remote: string;
  readonly place: string | null;
  /** Clickable only when https, and on a declared host for a mail's card; else null. */
  readonly link: string | null;
  readonly note: string | null;
  readonly column: string;
  readonly reason: string | null;
  readonly decidedBy: string;
  readonly toCheck: boolean;
  readonly createdAt: string;
  readonly movedAt: string | null;
  /**
   * For a card in one of the agent's columns: the id of the card in « applied »
   * or beyond for the same mission (ADR-0034, § 4), found at each request and
   * never stored; null otherwise.
   */
  readonly applied: number | null;
}

/** Mails I must read myself (ADR-0032 point 5, ADR-0034): counts only. */
export interface ToRead {
  readonly floor: number;
  readonly applications: number;
}

export interface ProspectionService {
  list(): Promise<CardView[]>;
  toRead(): Promise<ToRead>;
  add(input: unknown): Promise<CardView>;
  move(id: number, column: unknown): Promise<void>;
}

export interface ProspectionDeps {
  readonly store: Pick<ProspectionStore, "cards" | "addByHand" | "move" | "toReadByHand">;
  readonly config: () => ProspectionConfig;
  readonly journal: {
    append(e: { agent: string; type: string; payload?: Record<string, unknown> }): Promise<unknown>;
  };
}

const AGENT = "prospection";

const AGENT_COLUMN_SET: ReadonlySet<string> = new Set(AGENT_COLUMNS);
const APPLIED_OR_BEYOND = new Set(["applied", "interview", "won", "lost"]);
const OWN = "applied|";

/**
 * The same mission, by its alerts' key: a confirmation's card carries it
 * behind « applied| », a card I moved there myself carries it as is.
 */
function appliedByMission(cards: readonly Card[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const c of cards) {
    if (c.duplicateKey === null || !APPLIED_OR_BEYOND.has(c.column)) continue;
    const key = c.duplicateKey.startsWith(OWN) ? c.duplicateKey.slice(OWN.length) : c.duplicateKey;
    if (!found.has(key)) found.set(key, c.id);
  }
  return found;
}

function view(card: Card, config: ProspectionConfig, applied: number | null = null): CardView {
  return {
    id: card.id,
    source: card.source,
    platform: card.platform,
    title: card.title,
    company: card.company,
    intermediary: card.intermediary,
    stack: card.stack,
    rate: card.rate,
    remote: card.remote,
    place: card.place,
    link: shownLink(card, config),
    note: card.note,
    column: card.column,
    reason: card.reason,
    decidedBy: card.decidedBy,
    toCheck: card.toCheck,
    createdAt: card.createdAt.toISOString(),
    movedAt: card.movedAt?.toISOString() ?? null,
    applied,
  };
}

export function createProspectionService(deps: ProspectionDeps): ProspectionService {
  // Read at each request: an edited file counts at once; an unreadable one is said, never guessed.
  const settings = (): ProspectionConfig => {
    try {
      return deps.config();
    } catch (error) {
      if (error instanceof ProspectionConfigError) throw new BoardError(error.message);
      throw error;
    }
  };
  return {
    async list() {
      const config = settings();
      const cards = await deps.store.cards();
      const applied = appliedByMission(cards);
      return cards.map((c) =>
        view(
          c,
          config,
          c.duplicateKey !== null && AGENT_COLUMN_SET.has(c.column)
            ? (applied.get(c.duplicateKey) ?? null)
            : null,
        ),
      );
    },

    toRead: () => deps.store.toReadByHand(),

    async add(input) {
      const config = settings();
      const result = cardByHand(input, config);
      if (!result.ok) throw new BoardError(result.error);
      const { card } = result;
      const typed: NewCard = {
        source: "me",
        platform: null,
        title: card.title,
        company: card.company,
        intermediary: card.intermediary,
        stack: card.stack,
        rate: card.rate,
        remote: card.remote,
        place: card.place,
        link: card.link,
        note: card.note,
        column: card.column,
        reason: card.reason,
        decidedBy: card.decidedBy,
        toCheck: card.toCheck,
        duplicateKey: null,
      };
      const id = await deps.store.addByHand(typed);
      await deps.journal.append({
        agent: AGENT,
        type: "prospection.card_added",
        payload: { column: card.column },
      });
      const now = new Date();
      return view({ ...typed, id, createdAt: now, movedAt: null }, config);
    },

    async move(id, column) {
      if (typeof column !== "string" || !ALL_COLUMNS.includes(column)) {
        throw new BoardError("colonne inconnue");
      }
      const left = await deps.store.move(id, column);
      if (left === null) throw new BoardError("cette carte n'existe plus");
      await deps.journal.append({
        agent: AGENT,
        type: "prospection.card_moved",
        payload: { from: left, to: column },
      });
    },
  };
}
