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
  readonly contentType: "text/plain" | "text/html";
  readonly body: string;
  readonly expected: {
    readonly category: Category;
    readonly urgent: boolean;
    /** Kind of trap, or null for an ordinary message. */
    readonly trap: string | null;
  };
  readonly note: string;
}

export interface FixtureMailbox {
  readonly description: string;
  readonly categories: readonly Category[];
  readonly messages: readonly FixtureMessage[];
}

export const FIXTURE_PATH = join(import.meta.dirname, "..", "..", "..", "fixtures", "mails.json");

export function loadFixtureMailbox(path = FIXTURE_PATH): FixtureMailbox {
  return JSON.parse(readFileSync(path, "utf8")) as FixtureMailbox;
}
