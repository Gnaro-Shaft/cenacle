/**
 * What is kept from the model (phase 5, C2): a mail the article 9 floor sets
 * aside, or one with nothing to read (empty, or unreadable — the reader then
 * gives an empty view). One answer for every reason: callers never learn, and
 * never store, WHY a mail was set aside.
 */
import { type MailForModel, revealsSpecialCategory } from "@cenacle/core";

export function keptFromModel(mail: MailForModel): boolean {
  const empty = mail.subject.trim() === "" && mail.text.trim() === "";
  return empty || revealsSpecialCategory(mail);
}
