/**
 * The compliance report (phase 6, J4 — ADR-0022). Usage: npm run conformite
 *
 * Do the registers, the cadre, the code and the documentation agree? Six
 * deterministic checks, no AI. Locally, the real cadre.local.toml's four
 * durations are compared too — nothing else of that file is read or shown.
 * Exits 1 when a gap is not declared in docs/conformite/exceptions.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkConformity, loadFacts, parseExceptions } from "@cenacle/conformite";
import { errorText, refuseForeignSecrets } from "@cenacle/core";

refuseForeignSecrets("Le contrôle de conformité", []);
const ROOT = join(import.meta.dirname, "..", "..", "..");
try {
  const exceptions = parseExceptions(
    readFileSync(join(ROOT, "docs", "conformite", "exceptions.md"), "utf8"),
  );
  const verdict = checkConformity(loadFacts(ROOT, { local: true }), exceptions);
  for (const f of verdict.findings) console.log(`✘ [${f.check}] ${f.detail}`);
  for (const f of verdict.excused) console.log(`· [${f.check}] ${f.detail} (écart accepté)`);
  console.log(
    verdict.findings.length === 0
      ? `\n✔ Registres, cadre, code et documentation concordent (${verdict.excused.length} écart(s) accepté(s)).`
      : `\n${verdict.findings.length} écart(s) à corriger, ou à déclarer dans docs/conformite/exceptions.md.`,
  );
  if (verdict.findings.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`🛑 ${errorText(error)}`);
  process.exitCode = 1;
}
