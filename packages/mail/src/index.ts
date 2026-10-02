export { type Cadre, CadreError, loadCadre, type MailCadre, parseCadre } from "./cadre.ts";
export { type CollectSummary, collectMail } from "./collect.ts";
export { cleanForModel, htmlToText, toMailForModel } from "./mail-text.ts";
export { type FetchResult, fetchMailRefs, type MailRef, PostmanError } from "./postman.ts";
export { fixtureForModel, MAX_SOURCE_BYTES, readMailsForModel } from "./reader.ts";
export { sentToRfc822, toRfc822 } from "./rfc822.ts";
export {
  EXAMPLE_RULES_PATH,
  LOCAL_RULES_PATH,
  type LoadedRules,
  loadRules,
  parseRules,
  RULE_CATEGORIES,
  type RuleCategory,
  type RuleSort,
  type Rules,
  RulesError,
  type SortedRef,
  sortByRules,
} from "./rules.ts";
export { senderDomain } from "./sender-domain.ts";
export {
  assertTestMailbox,
  connectTestMailbox,
  countInbox,
  countMailbox,
  type LoadOptions,
  loadFixtures,
  type MailboxCounts,
  NotATestMailboxError,
  SENT_MAILBOX,
  type TestMailboxConfig,
  testMailboxConfigFromEnv,
} from "./test-mailbox.ts";
