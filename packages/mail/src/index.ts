export { type Cadre, CadreError, loadCadre, type MailCadre, parseCadre } from "./cadre.ts";
export { type CollectSummary, collectMail } from "./collect.ts";
export { type FetchResult, fetchMailRefs, type MailRef, PostmanError } from "./postman.ts";
export { toRfc822 } from "./rfc822.ts";
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
