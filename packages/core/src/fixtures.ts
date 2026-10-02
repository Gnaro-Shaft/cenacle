/**
 * The fictional test mailbox (fixtures/mails.json): its shape and loader.
 * Used by tests, the demo mail server and the classification benchmark.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CATEGORIES = ["clients_prospects", "administratif", "bruit", "a_trier"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface FixtureMessage {
  readonly id: string;
  readonly from: { readonly name: string; readonly address: string };
  readonly to: string;
  readonly subject: string;
  readonly date: string;
  /** Id of one of MY sent mails this message replies to (fixtures/sent.json), or null. */
  readonly inReplyTo: string | null;
  readonly contentType: "text/plain" | "text/html";
  readonly body: string;
  readonly expected: {
    readonly category: Category;
    readonly urgent: boolean;
    /** Kind of trap, or null for an ordinary message. */
    readonly trap: string | null;
    /** Whether I still owe a reply at `followUp.now` (phase 3). */
    readonly followUp: FollowUp;
  };
  readonly note: string;
}

export const FOLLOW_UPS = ["not_tracked", "replied", "waiting", "due"] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number];

export interface FixtureMailbox {
  readonly description: string;
  readonly categories: readonly Category[];
  readonly messages: readonly FixtureMessage[];
  /** The clock and rule the expected follow-ups were computed with. */
  readonly followUp: {
    readonly now: string;
    readonly workingHours: number;
    readonly timeZone: string;
    readonly noFollowUpDomains: readonly string[];
  };
}

/** A mail I sent (the Sent folder of the test mailbox). */
export interface FixtureSentMessage {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly date: string;
  /** Id of the incoming fixture it replies to, or null for a fresh mail. */
  readonly inReplyTo: string | null;
  /** Ids of the whole thread, oldest first (incoming and sent). */
  readonly references: readonly string[];
  readonly body: string;
}

export interface FixtureSentFolder {
  readonly description: string;
  readonly from: string;
  readonly messages: readonly FixtureSentMessage[];
}

export const FIXTURE_PATH = join(import.meta.dirname, "..", "..", "..", "fixtures", "mails.json");

export const SENT_FIXTURE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "sent.json",
);

export function loadFixtureSent(path = SENT_FIXTURE_PATH): FixtureSentFolder {
  return JSON.parse(readFileSync(path, "utf8")) as FixtureSentFolder;
}

/** Message-ID of a fixture (incoming or sent), as written in the test mailbox. */
export function fixtureMessageId(id: string): string {
  return `<${id}@fixtures.cenacle.test>`;
}

export function loadFixtureMailbox(path = FIXTURE_PATH): FixtureMailbox {
  return JSON.parse(readFileSync(path, "utf8")) as FixtureMailbox;
}
