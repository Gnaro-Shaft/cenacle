/**
 * M2 measure — sorting (phase 5).
 * Usage: npm run mesure:rangement [-- --max <n>] [-- --simuler]
 * Shows me, one by one, each mail Iris has sorted — sender and subject read
 * again from the server, in memory and read-only — with the category she
 * gave it. I say whether it is right, or which one it is. Only the counts are
 * printed at the end, ready to be published; my verdicts are not kept, not
 * even mail by mail. Nothing is written anywhere.
 *
 * --simuler: before the review, today's sorting is replayed on the same mails
 * (rules, mass mail, floor, local model — mesure-simulation.ts) and shown
 * next to Iris's decision. One judgment, two measures. The replay decides
 * nothing and keeps nothing; if the model stops answering, the measure stops.
 */
import {
  classifyMail,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import {
  CATEGORIES,
  type Category,
  errorText,
  refuseForeignSecrets,
  SecretPlacementError,
} from "@cenacle/core";
import { connectOrQuit } from "@cenacle/journal";
import {
  type Decider,
  forTerminal,
  loadRules,
  measureSorting,
  type SortingMeasure,
  type Verdict,
} from "@cenacle/mail";
import { readBack, readForReplay } from "./mesure-lecture.ts";
import { arrivedSince, parseMeasureOptions } from "./mesure-options.ts";
import { changesOf, type Judged, readAnswer } from "./mesure-revue.ts";
import { type Replayed, replaySorting } from "./mesure-simulation.ts";
import { createPrompt } from "./prompt.ts";

const LABEL: Readonly<Record<Category, string>> = {
  clients_prospects: "Clients et prospects",
  administratif: "Administratif",
  bruit: "Bruit",
  a_trier: "À trier",
};
const BY: Readonly<Record<Decider, string>> = {
  rule: "règle",
  model: "modèle",
  unreadable: "illisible",
  set_aside: "écarté du modèle",
  unauthenticated: "client non authentifié",
  masse: "courrier de masse",
};
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10} %`);

function printMeasure(title: string, r: SortingMeasure, of: string, who: string): void {
  console.log(`\n${title}`);
  console.log(`Mails jugés : ${r.total} (sur ${of})`);
  console.log(`Bien rangés : ${r.correct} (${pct(r.accuracy)})`);
  console.log(`Bien rangés hors « À trier » : ${pct(r.accuracyDecided)}`);
  console.log(`Laissés « À trier » : ${pct(r.aTrierShare)}`);
  console.log(`Clients ou prospects mis en « Bruit » : ${r.clientsInBruit}`);
  for (const [by, n] of Object.entries(r.byDecider)) {
    if (n.total > 0) console.log(`  par ${BY[by as Decider]} : ${n.correct}/${n.total}`);
  }
  console.log(`\n| ${who} \\ moi | ${CATEGORIES.map((c) => LABEL[c]).join(" | ")} |`);
  console.log(`|---|${CATEGORIES.map(() => "---").join("|")}|`);
  for (const c of CATEGORIES) {
    console.log(`| ${LABEL[c]} | ${CATEGORIES.map((t) => r.confusion[c][t]).join(" | ")} |`);
  }
}

refuseForeignSecrets("La mesure du rangement", ["mail"]);
const sql = connectOrQuit();
const prompt = createPrompt();
try {
  const { max, simulate, since } = parseMeasureOptions(process.argv.slice(2));
  // Only the mails arrived since the day are read again from the server (--depuis).
  const reading = await readBack(sql, (item) => arrivedSince(item.receivedAt, since));
  const sorted = reading.mails.filter(
    (m) =>
      m.item.category !== null &&
      m.item.decidedBy !== null &&
      arrivedSince(m.item.receivedAt, since),
  );
  const queue = sorted.slice(0, max);
  const scope =
    since === null ? "rangés" : `rangés, arrivés depuis le ${since.day} (minuit, Paris)`;
  let replayed: ReadonlyMap<number, Replayed> | null = null;
  let modelId = "";
  if (simulate) {
    const local = createLocalModels(localModelConfigFromEnv());
    modelId = local.model.id;
    const toReplay = await readForReplay(sql, { ...reading, mails: queue });
    console.log(
      `Simulation du tri d'aujourd'hui sur ${toReplay.length} mails (modèle ${modelId})…`,
    );
    replayed = await replaySorting(
      toReplay,
      loadRules().rules,
      (view) => classifyMail(view, { local }),
      (done, total) => process.stdout.write(`\r  modèle : ${done}/${total}`),
    );
    console.log("\n");
  }
  const verdicts: Verdict[] = [];
  const replayVerdicts: Verdict[] = [];
  const judged: Judged[] = [];
  const keys = "c clients · a administratif · b bruit · t à trier · q";
  console.log(
    `${queue.length} mails ${scope} à juger (Entrée = juste ; q pour finir et compter).\n`,
  );
  for (const [i, m] of queue.entries()) {
    const iris = m.item.category as Category;
    const decidedBy = m.item.decidedBy as Decider;
    const sim = replayed?.get(m.item.uid);
    const differ = sim !== undefined && sim.category !== iris;
    const name = forTerminal(m.fromName, 40);
    console.log(
      `[${i + 1}/${queue.length}] ${m.item.receivedAt.slice(0, 10)} · De : ${name ? `${name} ` : ""}<${forTerminal(m.from ?? "illisible", 80)}>`,
    );
    console.log(`         Objet : ${forTerminal(m.subject)}`);
    console.log(`         Iris : ${LABEL[iris]} (${BY[decidedBy]})`);
    if (replayed !== null) {
      const shown =
        sim === undefined ? "— (non relu)" : `${LABEL[sim.category]} (${BY[sim.decidedBy]})`;
      console.log(`         Simulé : ${shown}${differ ? "   ← diffère" : ""}`);
    }
    let truth: ReturnType<typeof readAnswer> = "again";
    while (truth === "again") {
      // End of input (Ctrl+D, a pipe run dry) counts what was judged, like "q".
      const raw = await prompt
        .ask(differ ? `Quelle case ? [${keys}] ` : `Juste ? [Entrée · ${keys}] `)
        .then(
          (a) => a,
          () => "q",
        );
      truth = readAnswer(raw, iris, sim?.category);
    }
    if (truth === "quit") break;
    verdicts.push({ iris, truth, decidedBy });
    if (sim !== undefined) {
      replayVerdicts.push({ iris: sim.category, truth, decidedBy: sim.decidedBy });
      judged.push({ iris, replayed: sim.category, truth });
    }
    console.log("");
  }
  const day = new Date().toISOString().slice(0, 10);
  printMeasure(
    `Mesure du rangement — ${day}`,
    measureSorting(verdicts),
    `${sorted.length} ${scope}`,
    "Iris",
  );
  if (replayed !== null) {
    printMeasure(
      `Simulation du tri d'aujourd'hui — ${day} (règles, courrier de masse, plancher, modèle ${modelId})`,
      measureSorting(replayVerdicts),
      `${sorted.length} ${scope}`,
      "Simulé",
    );
    const c = changesOf(judged);
    console.log(
      `\nDécisions changées : ${c.changed} sur ${judged.length} — meilleures : ${c.better}, pires : ${c.worse}`,
    );
  }
} catch (error) {
  if (error instanceof ModelUnavailableError) {
    console.error(
      "\n🛑 le modèle local ne répond plus (Ollama est-il lancé ?) : simulation arrêtée avant la revue, rien n'est mesuré",
    );
  } else {
    console.error(`🛑 ${errorText(error, [SecretPlacementError])}`);
  }
  process.exitCode = 1;
} finally {
  prompt.close();
  await sql.end();
}
