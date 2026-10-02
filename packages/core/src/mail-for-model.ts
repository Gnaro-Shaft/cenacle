/**
 * What the model is allowed to see of one mail, and nothing more.
 *
 * Lives in memory only, for the time of one classification: it is never
 * journaled, traced, stored or sent anywhere but to the local model.
 */
export interface MailForModel {
  readonly uid: number;
  readonly fromName: string;
  /** Sender domain as read by the postman; null when unreadable. */
  readonly domain: string | null;
  readonly subject: string;
  /** Plain text, HTML removed, at most MODEL_TEXT_MAX characters. */
  readonly text: string;
}

export const MODEL_TEXT_MAX = 2000;
export const MODEL_FIELD_MAX = 200;
