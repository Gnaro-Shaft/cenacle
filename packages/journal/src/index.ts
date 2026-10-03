export { connectAsApp } from "./connect.ts";
export {
  createJournal,
  InvalidEventError,
  type Journal,
  MAX_PAYLOAD_BYTES,
  type NewEvent,
  type Payload,
  type ReadOptions,
  readAllEvents,
  type StoredEvent,
} from "./journal.ts";
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
export {
  createProposalStore,
  type NewProposal,
  type Proposal,
  ProposalError,
  type ProposalStatus,
  type ProposalStore,
  TEXT_RETENTION_DAYS,
  UNDO_DELAY_MS,
} from "./proposal-store.ts";
