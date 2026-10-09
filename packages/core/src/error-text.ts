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

/**
 * The message of a UsageError or of an error of one of the `safe` classes;
 * the error's name otherwise, never its message. `Error` itself is never a
 * safe class: listing it would let every message through.
 */
export function errorText(error: unknown, safe: readonly SafeErrorClass[] = []): string {
  if (!(error instanceof Error)) return "erreur";
  const known = [UsageError, ...safe.filter((c) => c !== Error)];
  if (known.some((c) => error instanceof c)) return error.message;
  // A name is a class name; anything else may be data in disguise.
  return NAME.test(error.name) ? error.name : "Error";
}
