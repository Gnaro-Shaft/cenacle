// The security agent (J6, ADR-0025): checks, the finding lifecycle, the
// closed catalogue of fixes, the CTO's comment and the messages.
export {
  ANSWER,
  type Button,
  type ButtonAction,
  keyboard,
  MAX_BUTTON_DATA,
  MAX_BUTTON_ROWS,
  type PrAction,
  type Pressed,
  parsePressed,
  parsePrPressed,
  prKeyboard,
  withoutFinding,
} from "./buttons.ts";
export {
  isQuiet,
  LOCAL_CHECKS,
  localDay,
  NETWORK_EVERY_MS,
  networkDue,
  REPORT_AT,
  reportDue,
  reportSentToday,
  urgentNow,
} from "./cadence.ts";
export {
  CATALOGUE_TYPES,
  type Fix,
  fixFor,
  preparedFix,
  UnknownFindingError,
} from "./catalogue.ts";
export { buildCommentPrompt, COMMENT_SYSTEM_PROMPT, cleanComment } from "./comment.ts";
export {
  DELEGABLE,
  DELEGABLE_LABEL,
  type Delegable,
  type Delegation,
  DelegationConfigError,
  type DelegationState,
  delegableFix,
  delegationState,
  failures,
  parseDelegations,
  type TrustRecord,
} from "./delegations.ts";
export {
  type ActiveFinding,
  type ActiveStatus,
  DEBOUNCE_MINUTES,
  type Plan,
  reconcile,
  type SeenObservation,
} from "./lifecycle.ts";
export { classifyMotif, LEGION_STALE_MS, parseLegionVerdict } from "./parse-legion.ts";
export {
  parseFileVault,
  parseFirewall,
  parseGatekeeper,
  parseSip,
  parseSoftwareUpdate,
  parseTailscale,
  plainOutput,
} from "./parse-mac.ts";
export { advisoryText, NPM_NAME, parseNpmAudit, parseNpmOutdated, SEMVER } from "./parse-npm.ts";
export {
  PR_VIEW_FIELDS,
  type PrStatus,
  type PrView,
  parsePrStatus,
  parsePrView,
} from "./pr-status.ts";
export {
  type AcceptedFinding,
  AI_NOTICE,
  formatDaily,
  formatWeekly,
  type ReportFinding,
  TELEGRAM_MAX,
  type TrustLine,
} from "./report.ts";
export {
  CheckOutputError,
  type CheckResult,
  type FindingKey,
  keyOf,
  type Observation,
  SEVERITIES,
  SEVERITY_LABEL,
  type Severity,
} from "./types.ts";
