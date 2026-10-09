/**
 * Compliance, checked by code (phase 6, J4 — ADR-0022): the registers, the
 * cadre, the code and the documentation agree, or each gap is a finding.
 */

export {
  CHECKS,
  type CheckName,
  checkAi,
  checkDurations,
  checkReferences,
  checkSecrets,
  checkServices,
  checkTables,
  type Facts,
  type Finding,
} from "./checks.ts";
export { checkConformity } from "./conformity.ts";
export { conformityCto, conformityPrompt } from "./cto-pass.ts";
export { applyExceptions, type Exception, parseExceptions, type Verdict } from "./exceptions.ts";
export { loadFacts } from "./facts.ts";
export { type Row, TableError, table } from "./markdown.ts";
