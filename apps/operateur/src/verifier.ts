/**
 * Checks serveurs.local.toml with the operator's own reader, to run after any
 * change to it: an unknown key refuses every action until it is fixed.
 * Usage: npm run serveurs:verifier   (exit 1 when the operator would refuse it)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serversReport } from "./report.ts";

const path = join(import.meta.dirname, "..", "..", "..", "serveurs.local.toml");
const report = serversReport(existsSync(path) ? readFileSync(path, "utf8") : null);
for (const line of report.lines) console.log(line);
if (!report.ok) process.exitCode = 1;
