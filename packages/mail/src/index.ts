export { type Cadre, CadreError, loadCadre, type MailCadre, parseCadre } from "./cadre.ts";
export { type CollectSummary, collectMail } from "./collect.ts";
export { type FetchResult, fetchMailRefs, type MailRef, PostmanError } from "./postman.ts";
export { toRfc822 } from "./rfc822.ts";
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
  loadFixtures,
  type MailboxCounts,
  NotATestMailboxError,
  type TestMailboxConfig,
  testMailboxConfigFromEnv,
} from "./test-mailbox.ts";
