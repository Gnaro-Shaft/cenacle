/**
 * M2 measure — sorting (phase 5). Usage: npm run mesure:rangement [-- --max <n>]
 * Shows me, one by one, each mail Iris has sorted — sender and subject read
 * again from the server, in memory and read-only — with the category she
 * gave it. I say whether it is right, or which one it is. Only the counts are
 * printed at the end, ready to be published; my verdicts are not kept, not
 * even mail by mail. Nothing is written anywhere.
 */
import {
  CATEGORIES,
  type Category,
  errorText,
  refuseForeignSecrets,
  SecretPlacementError,
  UsageError,
} from "@cenacle/core";
import { connectOrQuit } from "@cenacle/journal";
import { type Decider, forTerminal, measureSorting, type Verdict } from "@cenacle/mail";
import { readBack } from "./mesure-lecture.ts";
import { createPrompt } from "./prompt.ts";

const LABEL: Readonly<Record<Category, string>> = {
  clients_prospects: "Clients et prospects",
  administratif: "Administratif",
  bruit: "Bruit",
  a_trier: "À trier",
};
const KEY: Readonly<Record<string, Category>> = {
  c: "clients_prospects",
  a: "administratif",
  b: "bruit",
  t: "a_trier",
};
const BY: Readonly<Record<Decider, string>> = {
  rule: "règle",
  model: "modèle",
  unreadable: "illisible",
  set_aside: "écarté du modèle",
  unauthenticated: "client non authentifié",
};
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10} %`);

const maxArg = process.argv.indexOf("--max");
const max = maxArg === -1 ? Number.POSITIVE_INFINITY : Number(process.argv[maxArg + 1]);
refuseForeignSecrets("La mesure du rangement", ["mail"]);
const sql = connectOrQuit();
const prompt = createPrompt();
try {
  if (!(max > 0)) throw new UsageError("--max attend un nombre positif");
  const { mails } = await readBack(sql);
  const sorted = mails.filter((m) => m.item.category !== null && m.item.decidedBy !== null);
  const queue = sorted.slice(0, max);
  const verdicts: Verdict[] = [];
  console.log(`${queue.length} mails rangés à juger (Entrée = juste ; q pour finir et compter).\n`);
  for (const [i, m] of queue.entries()) {
    const iris = m.item.category as Category;
    const decidedBy = m.item.decidedBy as Decider;
    const name = forTerminal(m.fromName, 40);
    console.log(
      `[${i + 1}/${queue.length}] ${m.item.receivedAt.slice(0, 10)} · De : ${name ? `${name} ` : ""}<${forTerminal(m.from ?? "illisible", 80)}>`,
    );
    console.log(`         Objet : ${forTerminal(m.subject)}`);
    console.log(`         Iris : ${LABEL[iris]} (${BY[decidedBy]})`);
    let truth: Category | "quit" | undefined;
    while (truth === undefined) {
      // End of input (Ctrl+D, a pipe run dry) counts what was judged, like "q".
      const answer = await prompt
        .ask("Juste ? [Entrée · c clients · a administratif · b bruit · t à trier · q] ")
        .then(
          (a) => a.trim().toLowerCase(),
          () => "q",
        );
      if (answer === "") truth = iris;
      else if (answer === "q") truth = "quit";
      else truth = Object.hasOwn(KEY, answer) ? KEY[answer] : undefined;
    }
    if (truth === "quit") break;
    verdicts.push({ iris, truth, decidedBy });
    console.log("");
  }
  const r = measureSorting(verdicts);
  console.log(`\nMesure du rangement — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Mails jugés : ${r.total} (sur ${sorted.length} rangés)`);
  console.log(`Bien rangés : ${r.correct} (${pct(r.accuracy)})`);
  console.log(`Bien rangés hors « À trier » : ${pct(r.accuracyDecided)}`);
  console.log(`Laissés « À trier » : ${pct(r.aTrierShare)}`);
  console.log(`Clients ou prospects mis en « Bruit » : ${r.clientsInBruit}`);
  for (const [by, n] of Object.entries(r.byDecider)) {
    if (n.total > 0) console.log(`  par ${BY[by as Decider]} : ${n.correct}/${n.total}`);
  }
  console.log(`\n| Iris \\ moi | ${CATEGORIES.map((c) => LABEL[c]).join(" | ")} |`);
  console.log(`|---|${CATEGORIES.map(() => "---").join("|")}|`);
  for (const c of CATEGORIES) {
    console.log(`| ${LABEL[c]} | ${CATEGORIES.map((t) => r.confusion[c][t]).join(" | ")} |`);
  }
} catch (error) {
  console.error(`🛑 ${errorText(error, [SecretPlacementError])}`);
  process.exitCode = 1;
} finally {
  prompt.close();
  await sql.end();
}
