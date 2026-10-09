/**
 * Runs every compliance check (ADR-0022) and applies the accepted exceptions.
 */
import { CHECKS, type Facts, type Finding } from "./checks.ts";
import { applyExceptions, type Exception, type Verdict } from "./exceptions.ts";
import { TableError } from "./markdown.ts";

/** Runs every check; a register that does not parse is a finding, never a silent pass. */
export function checkConformity(facts: Facts, exceptions: readonly Exception[] = []): Verdict {
  const found: Finding[] = [];
  for (const check of CHECKS) {
    try {
      found.push(...check(facts));
    } catch (error) {
      if (!(error instanceof TableError)) throw error;
      found.push({ check: "format", subject: check.name, detail: error.message });
    }
  }
  return applyExceptions(found, exceptions);
}
