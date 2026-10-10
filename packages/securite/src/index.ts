// The security agent (J6, ADR-0025): checks, the finding lifecycle, the
// closed catalogue of fixes, the CTO's comment and the messages.
export { CATALOGUE_TYPES, type Fix, fixFor, UnknownFindingError } from "./catalogue.ts";
export { buildCommentPrompt, COMMENT_SYSTEM_PROMPT, cleanComment } from "./comment.ts";
export {
  type ActiveFinding,
  type ActiveStatus,
  type Plan,
  reconcile,
  type SeenObservation,
} from "./lifecycle.ts";
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
  type AcceptedFinding,
  AI_NOTICE,
  formatDaily,
  formatWeekly,
  type ReportFinding,
  TELEGRAM_MAX,
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
