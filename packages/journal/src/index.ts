export { connectAsApp, connectAsExecutor, connectLockAsApp, connectOrQuit } from "./connect.ts";
export {
  holdSingleInstance,
  type InstanceLock,
  instanceLockKey,
  LOCK_CHECK_MS,
  type LockCheck,
  watchOrQuit,
} from "./instance-lock.ts";
export {
  createJournal,
  InvalidEventError,
  type Journal,
  latestEventAt,
  MAX_PAYLOAD_BYTES,
  type NewEvent,
  type Payload,
  type ReadOptions,
  readAllEvents,
  type StoredEvent,
} from "./journal.ts";
export {
  createLocationStore,
  type FolderCursor,
  type LocatedMail,
  type Location,
  type LocationStore,
  VIRTUAL_UID_VALIDITY,
} from "./mail-locations.ts";
export {
  CATEGORY_VALUES,
  createMailStore,
  type DecidedBy,
  type InboxItem,
  type Mailbox,
  type MailStore,
  type Position,
  type SentItem,
  type StoredCategory,
  type StoredInboxItem,
  type Totals,
} from "./mail-store.ts";
export { EXECUTOR_PASSWORD_VAR } from "./migrate.ts";
export {
  createPeople,
  type Erasure,
  type Holdings,
  type OppositionEntry,
  type People,
} from "./people.ts";
export {
  createProposalStore,
  type NewProposal,
  type Proposal,
  ProposalError,
  type ProposalStatus,
  type ProposalStore,
  type SignedAcceptance,
  UNDO_DELAY_MS,
} from "./proposal-store.ts";
export { createPurges, type Purges } from "./purges.ts";
export {
  createSecuriteDecisions,
  type Decision,
  type DecisionOutcome,
  type ReasonOutcome,
  type SecuriteDecisions,
} from "./securite-decisions.ts";
export {
  ACCEPTED_ASK_AGAIN_DAYS,
  CLOSED_KEEP_DAYS,
  createSecuriteStore,
  type FindingPlan,
  type FindingStatus,
  REFUSED_ASK_AGAIN_DAYS,
  type SecuriteStore,
  type SeenFinding,
  type StoredFinding,
} from "./securite-store.ts";
export {
  type ArchivedArticle,
  type ArchiveQuery,
  createVeilleStore,
  type NewArchivedArticle,
  type VeilleStore,
} from "./veille-store.ts";
