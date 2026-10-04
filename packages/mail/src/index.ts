export { isAcceptedByPage, signProposal } from "./acceptance.ts";
export {
  type Cadre,
  CadreError,
  loadCadre,
  type MailCadre,
  parseCadre,
  TEST_DOMAIN,
} from "./cadre.ts";
export {
  type CollectDeps,
  type CollectSummary,
  collectMail,
  mailTotals,
} from "./collect.ts";
export { createKeyer, KeyError, type Keyer, keyerFromEnv, messageIds } from "./keys.ts";
export { cleanForModel, htmlToText, toMailForModel } from "./mail-text.ts";
export { type PassDeps, type PassResult, runMailPass } from "./pass.ts";
export {
  type FetchResult,
  fetchMailRefs,
  fetchSentRefs,
  type MailRef,
  PostmanError,
  type SentRef,
  splitHeaders,
} from "./postman.ts";
export { createProposals, type Proposals, SKIP_REASONS, type SkipReason } from "./proposals.ts";
export { fixtureForModel, MAX_SOURCE_BYTES, readMailsForModel } from "./reader.ts";
export {
  type ReplyContext,
  type ReplyTarget,
  readReplyContexts,
  readReplyTargets,
  replyTargetOf,
  safeAddress,
  validMessageId,
} from "./reply-target.ts";
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
export {
  allowedRecipient,
  type BuiltReply,
  buildReply,
  copyToSent,
  replySubject,
  SendError,
  sendReply,
} from "./sender.ts";
export { addressList, senderAddress, senderDomain } from "./sender-domain.ts";
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
export {
  type Conservation,
  coveringTraitement,
  LEGAL_BASES,
  type LegalBasis,
  parseConservation,
  parseTraitements,
  type Traitement,
  TraitementError,
} from "./traitements.ts";
export {
  EXAMPLE_TRAMES_PATH,
  firstName,
  LOCAL_TRAMES_PATH,
  loadTrames,
  missing,
  parseTrames,
  type Rendered,
  renderTrame,
  SLOT_KINDS,
  type Slot,
  type SlotValues,
  slotsOf,
  type Trame,
  TrameError,
  type Trames,
  takenFromThread,
} from "./trames.ts";
