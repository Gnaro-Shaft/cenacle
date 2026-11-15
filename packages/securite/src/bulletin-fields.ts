/**
 * What every part of the bulletin reader shares (ADR-0039, ADR-0040): the one
 * error that makes a bulletin unreadable, and the reading of a whole number.
 */

export class BulletinError extends Error {
  constructor(message: string) {
    super(`unreadable bulletin: ${message}`);
    this.name = "BulletinError";
  }
}

const WHOLE = /^\d{1,15}$/;

/** A whole number at most `max`; null when the key is absent; else unreadable. */
export function whole(
  fields: ReadonlyMap<string, string>,
  key: string,
  max: number,
): number | null {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (!WHOLE.test(value) || Number(value) > max) throw new BulletinError(`${key} out of shape`);
  return Number(value);
}
