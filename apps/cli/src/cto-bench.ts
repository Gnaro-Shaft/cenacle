/**
 * Runs the bench of the CTO's review (J3b — ADR-0021).
 * Usage: npm run cto:bench [-- A,C]
 *
 * Each case: the commit that introduced a real defect is reviewed against its
 * parent, told nothing; found when one paragraph names the defect (criteria
 * fixed beforehand in cto-bench/cases.ts). Long: run it when the model is free.
 * The reviews are written to a temporary folder, for reading; nothing is kept
 * in the repository or the journal but the usual counts.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import { ctoModels, rangeTarget, reviewCto } from "@cenacle/cto";
import { connectAsApp, createJournal } from "@cenacle/journal";
import { BENCH, found } from "./cto-bench/cases.ts";

refuseForeignSecrets("Le banc du CTO", []);
const ROOT = join(import.meta.dirname, "..", "..", "..");
const only = process.argv[2]?.split(",");
const cases = BENCH.filter((c) => only === undefined || only.includes(c.id));
const out = mkdtempSync(join(tmpdir(), "cto-bench-"));
const sql = connectAsApp();
const journal = createJournal(sql);
const local = ctoModels();
let hits = 0;
try {
  for (const c of cases) {
    const started = Date.now();
    let reads = 0;
    try {
      const target = rangeTarget(ROOT, `${c.commit}^`, c.commit, `commit ${c.commit}`);
      const reply = await reviewCto(target, {
        root: ROOT,
        journal,
        local,
        onProgress: (p) => {
          if (p.kind === "tool") reads++;
        },
      });
      const ok = found(reply.text, c);
      if (ok) hits++;
      writeFileSync(join(out, `${c.id}.txt`), `${c.defect}\n\n${reply.text}\n\n${reply.summary}\n`);
      console.log(
        `${ok ? "✔" : "✘"} ${c.id} ${c.commit} — ${Math.round((Date.now() - started) / 1000)} s, ${reads} lecture(s) — ${c.defect}`,
      );
    } catch (error) {
      console.log(
        `✘ ${c.id} ${c.commit} — échec (${errorText(error)}) après ${Math.round((Date.now() - started) / 1000)} s`,
      );
    }
  }
  console.log(`\n${hits} / ${cases.length} défauts trouvés — relectures dans ${out}`);
  console.log(
    "Seuil : 3 sur 6 pour retirer « expérimental » ; moins de 2 sur 6 : envisager un modèle plus fort.",
  );
} finally {
  await sql.end();
}
