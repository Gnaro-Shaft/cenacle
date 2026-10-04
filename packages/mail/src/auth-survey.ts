/**
 * Step 0 of sender authentication (phase 5, before M3): what evidence does
 * the receiving server leave in the mails? Pure: headers in, counts out.
 *
 * Nothing that names anyone leaves this module: no domain, no address, no
 * header value. Even the servers that wrote an Authentication-Results header
 * come out as letters (A, B…), most frequent first — a header written by the
 * sender may name anything. The owner compares with the server name they read
 * themselves in their webmail (`given`): only "same or not" is said.
 */
import { parseAuthResults } from "./auth-results.ts";
import type { HeaderField } from "./ordered-headers.ts";
import { senderDomain } from "./sender-domain.ts";

export const OUTCOMES = [
  "pass",
  "fail",
  "softfail",
  "neutral",
  "none",
  "temperror",
  "permerror",
  "policy",
  "other",
  "absent",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const SURVEYED_METHODS = ["dmarc", "dkim", "spf"] as const;
type Method = (typeof SURVEYED_METHODS)[number];

/** One method in one header: its outcome, and whether a pass names the From domain exactly. */
export interface MethodSeen {
  readonly outcome: Outcome;
  readonly aligned: boolean;
}

export interface HeaderShape {
  /** Lowercased authserv-id; null if the header could not be read. Never shown. */
  readonly server: string | null;
  /** Received headers above this one: 0 means above them all. */
  readonly receivedAbove: number;
  readonly methods: Readonly<Record<Method, MethodSeen>>;
}

export interface MailAuthShape {
  readonly received: number;
  readonly fromReadable: boolean;
  readonly authResults: readonly HeaderShape[];
  readonly arc: boolean;
  readonly receivedSpf: boolean;
  readonly truncated: boolean;
}

/** The header names the survey fetches (headers only: never a subject nor a body). */
export const SURVEY_HEADERS = [
  "from",
  "received",
  "authentication-results",
  "arc-authentication-results",
  "received-spf",
];

const KNOWN: ReadonlySet<string> = new Set(OUTCOMES);
const toOutcome = (result: string): Outcome =>
  KNOWN.has(result) && result !== "absent" ? (result as Outcome) : "other";

/** The domain a method vouches for, compared exactly with the From domain. */
function vouchedDomain(method: Method, props: Readonly<Record<string, string>>): string | null {
  const value =
    method === "dmarc"
      ? props["header.from"]
      : method === "dkim"
        ? props["header.d"]
        : props["smtp.mailfrom"];
  if (value === undefined) return null;
  return method === "spf" ? (value.split("@").at(-1) ?? null) : value;
}

function methodsOf(value: string, fromDomain: string | null) {
  const parsed = parseAuthResults(value);
  const methods = {} as Record<Method, MethodSeen>;
  for (const method of SURVEYED_METHODS) {
    const seen = (parsed?.results ?? []).filter((r) => r.method === method);
    const passes = seen.filter((r) => r.result === "pass");
    methods[method] = {
      // A pass anywhere wins for the survey; otherwise the first result says it.
      outcome:
        passes.length > 0 ? "pass" : seen[0] === undefined ? "absent" : toOutcome(seen[0].result),
      aligned:
        fromDomain !== null && passes.some((r) => vouchedDomain(method, r.props) === fromDomain),
    };
  }
  return { server: parsed?.authservId ?? null, methods };
}

export function authShape(fields: readonly HeaderField[], truncated = false): MailAuthShape {
  const froms = fields.filter((f) => f.name === "from");
  const fromDomain = froms.length === 1 ? senderDomain(froms[0]?.value) : null;
  const authResults: HeaderShape[] = [];
  let received = 0;
  for (const field of fields) {
    if (field.name === "received") received++;
    else if (field.name === "authentication-results") {
      authResults.push({ receivedAbove: received, ...methodsOf(field.value, fromDomain) });
    }
  }
  return {
    received,
    fromReadable: fromDomain !== null,
    authResults,
    arc: fields.some((f) => f.name === "arc-authentication-results"),
    receivedSpf: fields.some((f) => f.name === "received-spf"),
    truncated,
  };
}

export type OutcomeCounts = Record<Outcome, number>;

export interface ServerSummary {
  /** "A", "B"…: the most frequent server first. */
  readonly label: string;
  /** Mails with at least one header from this server. */
  readonly mails: number;
  /** Mails where this server's header is the topmost Authentication-Results. */
  readonly topmost: number;
  /** Received headers above each of its headers → how many headers. */
  readonly positions: Readonly<Record<number, number>>;
  /** Mails with more than one header from this server. */
  readonly repeated: number;
  /** Null when no server name was given. */
  readonly matchesGiven: boolean | null;
  /** Its topmost header in each mail: outcome per method, and aligned passes. */
  readonly outcomes: Readonly<Record<Method, OutcomeCounts>>;
  readonly aligned: Readonly<Record<Method, number>>;
}

export interface Survey {
  readonly mails: number;
  readonly withAuthResults: number;
  readonly unreadableAuthResults: number;
  readonly unreadableFrom: number;
  readonly arc: number;
  readonly receivedSpf: number;
  readonly truncated: number;
  /** Received headers per mail → how many mails. */
  readonly receivedPerMail: Readonly<Record<number, number>>;
  readonly servers: readonly ServerSummary[];
  /** Mails with a header from a server beyond the ones listed. */
  readonly otherServerMails: number;
  /** Whether the given server name was seen at all; null when none was given. */
  readonly givenSeen: boolean | null;
}

export const MAX_SERVERS_LISTED = 6;
const LABELS = "ABCDEF";

const zeroOutcomes = (): OutcomeCounts =>
  Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as OutcomeCounts;

function serverSummary(
  server: string,
  label: string,
  shapes: readonly MailAuthShape[],
  given: string | null,
): ServerSummary {
  const positions: Record<number, number> = {};
  const outcomes = { dmarc: zeroOutcomes(), dkim: zeroOutcomes(), spf: zeroOutcomes() };
  const aligned = { dmarc: 0, dkim: 0, spf: 0 };
  let mails = 0;
  let topmost = 0;
  let repeated = 0;
  for (const shape of shapes) {
    const own = shape.authResults.filter((h) => h.server === server);
    const first = own[0];
    if (first === undefined) continue;
    mails++;
    if (shape.authResults[0]?.server === server) topmost++;
    if (own.length > 1) repeated++;
    for (const h of own) positions[h.receivedAbove] = (positions[h.receivedAbove] ?? 0) + 1;
    for (const method of SURVEYED_METHODS) {
      outcomes[method][first.methods[method].outcome]++;
      if (first.methods[method].aligned) aligned[method]++;
    }
  }
  return {
    label,
    mails,
    topmost,
    positions,
    repeated,
    matchesGiven: given === null ? null : server === given,
    outcomes,
    aligned,
  };
}

export function summarize(shapes: readonly MailAuthShape[], givenServer?: string): Survey {
  const given = givenServer === undefined ? null : givenServer.trim().toLowerCase();
  const frequency = new Map<string, number>();
  const receivedPerMail: Record<number, number> = {};
  for (const shape of shapes) {
    receivedPerMail[shape.received] = (receivedPerMail[shape.received] ?? 0) + 1;
    for (const server of new Set(shape.authResults.map((h) => h.server))) {
      if (server !== null) frequency.set(server, (frequency.get(server) ?? 0) + 1);
    }
  }
  const ranked = [...frequency.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const listed = ranked.slice(0, MAX_SERVERS_LISTED);
  const unlisted = new Set(ranked.slice(MAX_SERVERS_LISTED));
  return {
    mails: shapes.length,
    withAuthResults: shapes.filter((s) => s.authResults.length > 0).length,
    unreadableAuthResults: shapes.filter((s) => s.authResults.some((h) => h.server === null))
      .length,
    unreadableFrom: shapes.filter((s) => !s.fromReadable).length,
    arc: shapes.filter((s) => s.arc).length,
    receivedSpf: shapes.filter((s) => s.receivedSpf).length,
    truncated: shapes.filter((s) => s.truncated).length,
    receivedPerMail,
    servers: listed.map((server, i) => serverSummary(server, LABELS[i] ?? "?", shapes, given)),
    otherServerMails: shapes.filter((s) =>
      s.authResults.some((h) => h.server !== null && unlisted.has(h.server)),
    ).length,
    givenSeen: given === null ? null : frequency.has(given),
  };
}
