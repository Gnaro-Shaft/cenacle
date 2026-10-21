/**
 * Mass mail (ADR-0029): a mail sent in bulk says so in its headers — a list
 * to leave (List-Unsubscribe, List-Id) or a bulk precedence. Read by code,
 * no model; reduced to one boolean, never stored.
 *
 * Anyone can write these headers: they may only send a mail down to "Bruit"
 * (rules.ts decides), never up. A header written twice still counts — a
 * duplicate must not hide it, unlike From (splitHeaders) where it means
 * ambiguity.
 */
import type { HeaderField } from "./ordered-headers.ts";

/** Fetched with the other inbox headers (postman.ts). */
export const MASS_HEADERS = ["list-unsubscribe", "list-id", "precedence"] as const;

const LIST_HEADERS = new Set(["list-unsubscribe", "list-id"]);
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

export function isMassMail(fields: readonly HeaderField[]): boolean {
  for (const { name, value } of fields) {
    const v = value.trim();
    if (LIST_HEADERS.has(name) && v !== "") return true;
    // "Precedence: bulk" — the first word only, any case; comments dropped.
    if (name === "precedence") {
      const word =
        v
          .replace(/\([^()]*\)/g, " ")
          .trim()
          .split(/[\s;]+/)[0]
          ?.toLowerCase() ?? "";
      if (BULK_PRECEDENCE.has(word)) return true;
    }
  }
  return false;
}
