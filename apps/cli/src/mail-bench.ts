/**
 * Measures the local model on the fictional mailbox (M5).
 * By default: the mails that the example rules leave to the model.
 * Usage: npm run mail:bench [-- --all]   (--all: every fixture goes to the model)
 */

import { readFileSync } from "node:fs";
import { classifyMail, createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { CATEGORIES, errorText, loadFixtureMailbox } from "@cenacle/core";
import {
  capped,
  ceilingOf,
  EXAMPLE_RULES_PATH,
  fixtureForModel,
  fixtureListFields,
  isMassMail,
  keptFromModel,
  parseRules,
  sortByRules,
} from "@cenacle/mail";
import { type BenchItem, scoreBench } from "./bench-score.ts";

const all = process.argv.includes("--all");
try {
  const local = createLocalModels(localModelConfigFromEnv());
  const { messages } = loadFixtureMailbox();
  const views = messages.map((m, i) => fixtureForModel(i + 1, m));
  // Always the example rules: the benchmark measures the fictional mailbox only.
  const rules = parseRules(readFileSync(EXAMPLE_RULES_PATH, "utf8"));
  // The fixtures all carry an authenticated sender (cadre.toml, rfc822.ts); their
  // bulk-mail headers are judged by the same function as in production (ADR-0029).
  const ruleSort = sortByRules(
    views.map((v, i) => ({
      uid: v.uid,
      domain: v.domain,
      address: (messages[i] as (typeof messages)[number]).from.address.toLowerCase(),
      auth: "authenticated" as const,
      mass: isMassMail(fixtureListFields(messages[i] as (typeof messages)[number])),
    })),
    rules,
  );
  const toModel = all ? views : ruleSort.remaining.map((ref) => views[ref.uid - 1]);
  // Mass mail is decided before the model: counted apart, not in the M5 score.
  const massed = ruleSort.sorted.filter((s) => s.decidedBy === "masse");
  const massRight = massed.filter((s) => messages[s.uid - 1]?.expected.category === "bruit");
  console.log(
    `Courrier de masse (ADR-0029) : ${massed.length} rangés en « Bruit » par leurs en-têtes, ${massRight.length} attendus en « Bruit »`,
  );

  console.log(
    `Modèle ${local.model.id} — ${toModel.length} mails${all ? " (tous)" : " (laissés par les règles)"}`,
  );
  const items: BenchItem[] = [];
  for (const view of toModel) {
    if (view === undefined) continue;
    const fixture = messages[view.uid - 1];
    if (fixture === undefined) continue;
    // C2: as in production, a mail the floor sets aside goes to "À trier", unread by the model.
    const setAside = keptFromModel(view);
    const result = setAside
      ? { category: "a_trier" as const, valid: true, durationMs: 0 }
      : await classifyMail(view, { local }).then((r) => ({
          ...r,
          // ADR-0030: never above the rule of a mass mail's domain, as in production.
          category: capped(
            r.category,
            ceilingOf(isMassMail(fixtureListFields(fixture)), view.domain, rules),
          ),
        }));
    items.push({
      id: fixture.id,
      expected: fixture.expected.category,
      got: result.category,
      valid: result.valid,
      trap: fixture.expected.trap,
      durationMs: result.durationMs,
    });
    const mark = result.category === fixture.expected.category ? "✓" : "✗";
    process.stdout.write(
      `${mark} ${fixture.id} ${fixture.expected.category} → ${result.category}${setAside ? " (écarté du modèle)" : ""}${result.valid ? "" : " (réponse invalide)"}${fixture.expected.trap ? ` [piège ${fixture.expected.trap}]` : ""}\n`,
    );
  }

  const s = scoreBench(items);
  console.log(`\nAttendu \\ obtenu   ${CATEGORIES.map((c) => c.slice(0, 7).padStart(8)).join("")}`);
  for (const expected of CATEGORIES) {
    console.log(
      expected.padEnd(19) +
        CATEGORIES.map((got) => String(s.confusion[expected][got]).padStart(8)).join(""),
    );
  }
  console.log(`\nBien rangés : ${s.correct}/${s.total} (${Math.round(s.accuracy * 100)} %)`);
  console.log(
    `Part « À trier » : ${Math.round(s.aTrierShare * 100)} % — réponses invalides : ${s.invalid}`,
  );
  console.log(
    `Clients rangés en bruit : ${s.clientsInBruit} — pièges suivis : ${s.trapsFollowed.length}${s.trapsFollowed.length ? ` (${s.trapsFollowed.join(", ")})` : ""}`,
  );
  console.log(`Temps par mail : ${s.meanMs} ms en moyenne, ${s.maxMs} ms au pire`);
  if (s.failures.length === 0) {
    console.log("\n✔ Critères M5 atteints");
  } else {
    console.log(`\n🛑 Critères M5 non atteints : ${s.failures.join(" ; ")}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`🛑 ${errorText(error)}`);
  process.exitCode = 1;
}
