/**
 * Measures phase 4's exit criterion (B5): no sending without my acceptance,
 * no invented fact in a draft. No model, no mail server; needs PostgreSQL
 * (npm run db:up) and uses the test database only. Usage: npm run draft:bench
 */
import { runDraftBench } from "./draft-bench/bench.ts";

const report = await runDraftBench();
let scenario = "";
for (const c of report.checks) {
  if (c.scenario !== scenario) {
    scenario = c.scenario;
    console.log(`\n— ${scenario}`);
  }
  console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.ok || c.detail === "" ? "" : ` — ${c.detail}`}`);
}
const i = report.invention;
const failed = report.checks.filter((c) => !c.ok).length;
console.log(
  `\nBanc d'invention : ${i.drafts} brouillons tentés, ${i.proposed} proposés, ${i.leaks.length} fait inventé ; ${i.legitKept}/${i.legitOffered} valeurs copiées du mail gardées`,
);
console.log(
  report.ok
    ? `\n✅ ${report.checks.length} vérifications : aucun envoi sans acceptation, aucun fait inventé`
    : `\n❌ ${failed}/${report.checks.length} vérifications en échec`,
);
process.exitCode = report.ok ? 0 : 1;
