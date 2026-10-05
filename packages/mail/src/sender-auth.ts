/**
 * Was this mail really sent by its From domain? (phase 5, before M3, ADR-0014)
 *
 * The only evidence believed is the Authentication-Results header that OUR
 * receiving server added. Anyone can write that header in the mail they send,
 * with our server's name in it, so it is believed only when all of this holds:
 *
 * - its server name is exactly ours (`authservId`, cadre.local.toml);
 * - exactly `receivedAbove` Received headers sit above it — where our server
 *   puts it, measured by the survey (step 0); a header the sender wrote sits
 *   lower, under our server's own Received headers;
 * - it is the only header in the mail that names our server: a second one is
 *   an injection, and then neither is believed.
 *
 * Authenticated means: dmarc=pass for exactly the From domain, or — when the
 * domain publishes no DMARC policy (absent or "none") — dkim=pass signed by
 * exactly the From domain. SPF alone never: it vouches for the envelope, not
 * for the From a person reads. Anything else is "not authenticated", with a
 * reason that is counted, never a guess.
 */
import { type AuthResults, parseAuthResults } from "./auth-results.ts";
import type { HeaderField } from "./ordered-headers.ts";

export interface TrustedServer {
  /** Lowercased name our receiving server writes first in its header. */
  readonly authservId: string;
  /** Received headers above its header, as measured on the real mailbox. */
  readonly receivedAbove: number;
}

/**
 * - missing: no header from our server at all;
 * - duplicated: more than one header naming our server (an injection);
 * - misplaced: our server's name, not where our server puts it;
 * - unreadable: our server's header cannot be read, or the header block was cut;
 * - failed: our server's header, read — no aligned pass (forged From, failed checks…).
 */
export const AUTH_VERDICTS = [
  "authenticated",
  "missing",
  "duplicated",
  "misplaced",
  "unreadable",
  "failed",
] as const;
export type AuthVerdict = (typeof AUTH_VERDICTS)[number];

/** Our server's header was found where expected, alone and readable. */
export const hasTrustedHeader = (verdict: AuthVerdict): boolean =>
  verdict === "authenticated" || verdict === "failed";

/** The server name an A-R header claims, read without trusting the rest. */
function claimedServer(value: string): string {
  return (/^\s*([^\s;(]+)/.exec(value)?.[1] ?? "").toLowerCase();
}

function verdictOf(header: AuthResults, fromDomain: string): "authenticated" | "failed" {
  const dmarc = header.results.filter((r) => r.method === "dmarc");
  if (dmarc.length > 0) {
    // Several DMARC results must all agree: one that is not an aligned pass decides against.
    if (dmarc.every((r) => r.result === "pass" && r.props["header.from"] === fromDomain)) {
      return "authenticated";
    }
    if (dmarc.some((r) => r.result !== "none")) return "failed";
  }
  const signed = header.results.some(
    (r) => r.method === "dkim" && r.result === "pass" && r.props["header.d"] === fromDomain,
  );
  return signed ? "authenticated" : "failed";
}

/**
 * `fields`: the mail's headers in order (orderedHeaders), `truncated` when the
 * block was cut. `fromDomain`: senderDomain of its single From, or null.
 */
export function senderAuthentication(
  fields: readonly HeaderField[],
  truncated: boolean,
  fromDomain: string | null,
  server: TrustedServer,
): AuthVerdict {
  const ours: { value: string; receivedAbove: number }[] = [];
  let received = 0;
  for (const field of fields) {
    if (field.name === "received") received++;
    else if (
      field.name === "authentication-results" &&
      claimedServer(field.value) === server.authservId
    ) {
      ours.push({ value: field.value, receivedAbove: received });
    }
  }
  const [header, ...others] = ours;
  // A cut block may hide a second header below: never believed.
  if (truncated) return "unreadable";
  if (header === undefined) return "missing";
  if (others.length > 0) return "duplicated";
  if (header.receivedAbove !== server.receivedAbove) return "misplaced";
  const parsed = parseAuthResults(header.value);
  if (parsed === null || parsed.authservId !== server.authservId) return "unreadable";
  if (fromDomain === null) return "failed";
  return verdictOf(parsed, fromDomain);
}
