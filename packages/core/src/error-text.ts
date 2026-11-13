// What a program may print about an error it caught. A mail server's or a
// database's message may quote a host, an account or an address: only the
// messages the project writes itself, with no personal data in them, are shown.

/** A message the project writes itself, holding no personal data: always shown. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** An error class whose messages are known to hold no personal data. */
// biome-ignore lint/suspicious/noExplicitAny: any constructor signature is accepted
export type SafeErrorClass = abstract new (...args: any[]) => Error;

const NAME = /^\w{1,40}$/;
/** A code a library sets: `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`, a SQLSTATE like `57P01`. */
const CODE = /^(?:[A-Z][A-Z0-9_]{1,39}|[0-9A-Z]{5})$/;

/** `Name`, then ` (CODE)` when the error carries a code shaped like one — never anything else. */
function nameOf(error: Error): string {
  const name = NAME.test(error.name) ? error.name : "Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODE.test(code) ? `${name} (${code})` : name;
}

/**
 * The message of a UsageError or of an error of one of the `safe` classes;
 * otherwise the error's name, with its code and its cause's when they have
 * the shape of an identifier (`TypeError ← Error (ECONNREFUSED)`), never a
 * message. `Error` itself is never a
 * safe class: listing it would let every message through.
 */
export function errorText(error: unknown, safe: readonly SafeErrorClass[] = []): string {
  if (!(error instanceof Error)) return "erreur";
  const known = [UsageError, ...safe.filter((c) => c !== Error)];
  if (known.some((c) => error instanceof c)) return error.message;
  // A name is a class name, a code an identifier; anything else may be data in disguise.
  // One level of cause: `fetch failed` says nothing, its cause says why (lot C, 13/11).
  const cause = error.cause;
  return cause instanceof Error ? `${nameOf(error)} ← ${nameOf(cause)}` : nameOf(error);
}
