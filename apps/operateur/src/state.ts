/**
 * The operator says its state at each pass (ADR-0027, revised 2026-10-14):
 * when, and whether serveurs.local.toml can be used — its kind of problem,
 * never a value from it. Written whole (a temporary file renamed over the
 * old one), readable by me only; the security agent reads it.
 */
import { renameSync, writeFileSync } from "node:fs";
import {
  formatOperatorState,
  type ServersConfig,
  type ServersConfigProblem,
} from "@cenacle/securite";

export function publishState(
  path: string,
  config: ServersConfig | ServersConfigProblem,
  nowMs: number,
): void {
  const text = formatOperatorState({
    instantMs: nowMs,
    config: typeof config === "string" ? config : "ok",
  });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}
