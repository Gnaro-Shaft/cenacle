/**
 * One pass of the prospection agent (ADR-0032): the "missions" alerts not yet
 * read, each re-checked at its source, set aside by the article 9 floor or
 * read by the model, its missions sorted and kept as cards. Then the purge.
 * A mail from a declared confirmation address (ADR-0034) takes the other
 * path: the single mission I applied to becomes a card in "applied".
 *
 * Everything outside is injected (mailbox, model, base, journal): the pass
 * decides, it holds no secret. Nothing is ever silent: each mail ends with an
 * outcome, each dropped entry is counted, and the journal gets numbers only.
 * If the model stops answering, the pass stops; the mails stay to read.
 */
import {
  APPLICATION_SYSTEM_PROMPT,
  applicationKeys,
  buildApplicationPrompt,
  parseApplication,
} from "./application.ts";
import { bodyOf } from "./body.ts";
import type { Platform, ProspectionConfig } from "./config.ts";
import {
  buildExtractPrompt,
  EXTRACT_SYSTEM_PROMPT,
  ExtractError,
  type Offer,
  parseExtraction,
} from "./extract.ts";
import { type AgentColumn, duplicateKey, triage } from "./triage.ts";

export const AGENT = "prospection";
/** Alerts read per pass at most: a few minutes of model, the rest at the next pass. */
export const MAILS_PER_PASS = 20;

export type Outcome =
  | "read"
  | "floor"
  | "too_big"
  | "not_platform"
  | "unauthenticated"
  | "unparsable"
  | "no_offer"
  | "application"
  | "application_unreadable";

export interface MissionMail {
  /** Iris's fixed id (ADR-0016). */
  readonly id: number;
  /** Our server's verdict, kept by Iris (ADR-0014). */
  readonly senderAuthenticated: boolean;
}

export interface Source {
  readonly uid: number;
  readonly source: Buffer;
  readonly complete: boolean;
}

export interface CardToKeep extends Offer {
  readonly platform: string;
  readonly column: AgentColumn;
  readonly reason: string | null;
  readonly decidedBy: "rule" | "model" | "me";
  readonly toCheck: boolean;
  readonly duplicateKey: string | null;
}

/** A confirmation's mission (ADR-0034): kept in "applied", unless already there or beyond. */
export interface ApplicationToKeep extends Offer {
  readonly platform: string;
  /** Its own key, and the alerts' key of the same mission; null when the company is not said. */
  readonly keys: { readonly own: string; readonly alert: string } | null;
}

export interface RunDeps {
  readonly config: ProspectionConfig;
  readonly journal: {
    append(e: { agent: string; type: string; payload?: Record<string, unknown> }): Promise<unknown>;
  };
  readonly missionMails: () => Promise<readonly MissionMail[]>;
  readonly unread: (ids: readonly number[]) => Promise<number[]>;
  readonly readSources: (ids: readonly number[]) => Promise<readonly Source[]>;
  /** The sender's exact address, read again at the source (charter, rule 5). */
  readonly senderAddress: (source: Buffer) => string | null;
  /** The article 9 floor on the whole text the model would read. */
  readonly sensitive: (text: string) => boolean;
  readonly ask: (question: string, systemPrompt: string) => Promise<string>;
  readonly isModelUnavailable: (error: unknown) => boolean;
  readonly recordMail: (
    id: number,
    outcome: Outcome,
    cards: readonly CardToKeep[],
  ) => Promise<{ added: number; duplicates: number }>;
  readonly recordApplication: (id: number, card: ApplicationToKeep) => Promise<{ added: boolean }>;
  readonly purge: (cutoff: Date) => Promise<number>;
  readonly retentionDays: number;
  readonly now: () => Date;
  readonly nonce: () => string;
}

export interface PassSummary {
  readonly counts: Readonly<Record<string, number>>;
  /** True when the model stopped answering: the rest waits for the next pass. */
  readonly waiting: boolean;
}

const OUTCOMES: readonly Outcome[] = [
  "read",
  "floor",
  "too_big",
  "not_platform",
  "unauthenticated",
  "unparsable",
  "no_offer",
  "application",
  "application_unreadable",
];

export async function runProspection(deps: RunDeps): Promise<PassSummary> {
  const { config } = deps;
  const counts: Record<string, number> = Object.fromEntries(
    [
      ...OUTCOMES,
      "gone",
      "offers",
      "rejected",
      "over_cap",
      "cut",
      "added",
      "duplicates",
      "detected",
      "direct",
      "profile",
      "alert",
      "to_check",
      "purged",
      "left",
      "applications_added",
      "applications_duplicate",
    ].map((k) => [k, 0]),
  );
  const byDomain = new Map<string, Platform>(config.platforms.map((p) => [p.senderDomain, p]));
  const mails = await deps.missionMails();
  const auth = new Map(mails.map((m) => [m.id, m.senderAuthenticated]));
  const unread = await deps.unread(mails.map((m) => m.id));
  const batch = unread.slice(0, MAILS_PER_PASS);
  counts.left = unread.length - batch.length;
  const sources = new Map((await deps.readSources(batch)).map((s) => [s.uid, s]));
  let waiting = false;

  const finish = async (id: number, outcome: Outcome, cards: readonly CardToKeep[] = []) => {
    const kept = await deps.recordMail(id, outcome, cards);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    counts.added = (counts.added ?? 0) + kept.added;
    counts.duplicates = (counts.duplicates ?? 0) + kept.duplicates;
  };

  for (const id of batch) {
    const read = sources.get(id);
    if (read === undefined) {
      counts.gone = (counts.gone ?? 0) + 1; // gone from the server: Iris forgets it, and the mark with it
      continue;
    }
    if (!read.complete) {
      await finish(id, "too_big");
      continue;
    }
    const address = deps.senderAddress(read.source)?.toLowerCase() ?? null;
    const domain = address?.split("@")[1];
    const platform = domain === undefined ? undefined : byDomain.get(domain);
    if (platform === undefined) {
      await finish(id, "not_platform");
      continue;
    }
    if (auth.get(id) !== true) {
      await finish(id, "unauthenticated");
      continue;
    }
    const body = await bodyOf(read.source, config.textMax);
    if (body.text === "") {
      await finish(id, "unparsable");
      continue;
    }
    if (body.cut) counts.cut = (counts.cut ?? 0) + 1;
    if (deps.sensitive(body.text)) {
      await finish(id, "floor");
      continue;
    }
    // The code decides which path, on the exact address; never the model.
    const application = address !== null && platform.applicationAddresses.has(address);
    let answer: string;
    try {
      answer = application
        ? await deps.ask(buildApplicationPrompt(body.text, deps.nonce()), APPLICATION_SYSTEM_PROMPT)
        : await deps.ask(buildExtractPrompt(body.text, deps.nonce()), EXTRACT_SYSTEM_PROMPT);
    } catch (error) {
      if (!deps.isModelUnavailable(error)) throw error;
      waiting = true;
      break;
    }
    if (application) {
      const offer = parseApplication(answer, body.links, platform);
      if (offer === null) {
        await finish(id, "application_unreadable");
        continue;
      }
      const kept = await deps.recordApplication(id, {
        ...offer,
        platform: platform.name,
        keys: applicationKeys(offer, platform.name),
      });
      counts.application = (counts.application ?? 0) + 1;
      if (kept.added) counts.applications_added = (counts.applications_added ?? 0) + 1;
      else counts.applications_duplicate = (counts.applications_duplicate ?? 0) + 1;
      continue;
    }
    let offers: readonly Offer[];
    try {
      const extraction = parseExtraction(answer, body.links, platform, config.perMailMax);
      offers = extraction.offers;
      counts.rejected = (counts.rejected ?? 0) + extraction.rejected;
      counts.over_cap = (counts.over_cap ?? 0) + extraction.overCap;
    } catch (error) {
      if (!(error instanceof ExtractError)) throw error;
      await finish(id, "unparsable");
      continue;
    }
    const cards = offers.map((offer): CardToKeep => {
      const t = triage(offer, config, "mail", platform);
      counts[t.column] = (counts[t.column] ?? 0) + 1;
      if (t.toCheck) counts.to_check = (counts.to_check ?? 0) + 1;
      return {
        ...offer,
        platform: platform.name,
        column: t.column,
        reason: t.reason,
        decidedBy: t.decidedBy,
        toCheck: t.toCheck,
        duplicateKey: duplicateKey(offer, platform.name),
      };
    });
    counts.offers = (counts.offers ?? 0) + cards.length;
    await finish(id, cards.length === 0 ? "no_offer" : "read", cards);
  }

  const cutoff = new Date(deps.now().getTime() - deps.retentionDays * 86_400_000);
  counts.purged = await deps.purge(cutoff);
  if (waiting) {
    await deps.journal.append({
      agent: AGENT,
      type: "prospection.model_waiting",
      payload: { waiting: batch.length - countsDone(counts) },
    });
    await deps.journal.append({
      agent: AGENT,
      type: "state.changed",
      payload: { to: "waiting_for_local_model" },
    });
  }
  await deps.journal.append({ agent: AGENT, type: "prospection.passed", payload: { ...counts } });
  return { counts, waiting };
}

function countsDone(counts: Readonly<Record<string, number>>): number {
  return OUTCOMES.reduce((n, o) => n + (counts[o] ?? 0), 0) + (counts.gone ?? 0);
}
