/**
 * The draft bench (phase 4, B5): the exit criterion of phase 4, measured on
 * the real table, page API, drafting and executor — no model, no mail server.
 *   - no path to sending without my acceptance on the page (injection,
 *     double click, replay, undo delay, slots, lapsed proposals);
 *   - no invented fact in any proposal.
 * Each run starts from a fresh test database (cenacle_test, never the real one).
 */
import { appConnection, resetTestDatabase } from "@cenacle/journal/test-db";
import type { Check } from "./checks.ts";
import { benchContext } from "./context.ts";
import { type InventionReport, inventionBench } from "./invention.ts";
import { lapsed, replay } from "./scenarios-replay.ts";
import { doubleClick, injection, undoDelay } from "./scenarios-send.ts";
import type { Mutations } from "./world.ts";

export interface DraftBenchReport {
  readonly checks: readonly Check[];
  readonly invention: InventionReport;
  readonly ok: boolean;
}

const SCENARIOS = [
  ["injection", injection],
  ["double clic", doubleClick],
  ["délai et cases", undoDelay],
  ["rejeu", replay],
  ["proposition caduque", lapsed],
] as const;

export async function runDraftBench(mutations?: Mutations): Promise<DraftBenchReport> {
  await resetTestDatabase();
  const sql = appConnection();
  try {
    const ctx = benchContext(sql, mutations);
    const checks: Check[] = [];
    for (const [name, run] of SCENARIOS) {
      try {
        checks.push(...(await run(ctx)));
      } catch (error) {
        // A crash is a failure of the scenario, said by its name only.
        const why = error instanceof Error ? `${error.name}: ${error.message}` : "error";
        checks.push({ scenario: name, name: "a planté", ok: false, detail: why });
      }
    }
    const invention = await inventionBench(ctx);
    checks.push(...invention.checks);
    return { checks, invention: invention.report, ok: checks.every((c) => c.ok) };
  } finally {
    await sql.end();
  }
}
