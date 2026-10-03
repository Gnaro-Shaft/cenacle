/**
 * Phase 3 exit criterion, measured. Usage: npm run alert:bench
 * Replays the fictional mailbox (21/09 → 01/10) minute by minute through
 * Iris's real rhythm — once nominal, once with Telegram down two hours.
 */
import { runAlertBench } from "./bench.ts";

const scenarios = [
  { name: "nominal", outages: [] },
  {
    name: "Telegram en panne le 01/10 de 8 h 30 à 10 h 30",
    outages: [
      { from: new Date("2026-10-01T08:30:00+02:00"), to: new Date("2026-10-01T10:30:00+02:00") },
    ],
  },
];

let failed = false;
for (const { name, outages } of scenarios) {
  const r = await runAlertBench(outages);
  console.log(`\n— ${name}`);
  console.log(
    `  urgents : ${r.urgentSignalled} signalés / ${r.urgentExpected} attendus — manqués ${r.missed.length}, en retard ${r.late.length}, en trop ${r.extraUrgent}`,
  );
  console.log(
    `  récaps  : ${r.recaps} envoyés / ${r.recapsExpected} attendus — messages en heures calmes : ${r.quietMessages}`,
  );
  console.log(`  contenu dans Telegram : ${r.leaks.length}`);
  for (const l of r.late) console.log(`    en retard : ${l}`);
  // With an outage, recaps are sent late and some are merged: only losses count.
  const failures =
    outages.length === 0 ? r.failures : r.failures.filter((f) => !/récaps|retard/.test(f));
  if (failures.length > 0) {
    failed = true;
    console.log(`  🛑 ${failures.join(" ; ")}`);
  } else {
    console.log("  ✔ critère atteint");
  }
}
process.exitCode = failed ? 1 : 0;
