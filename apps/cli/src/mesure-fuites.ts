/**
 * M2 measure — leaks (phase 5). Usage: npm run mesure:fuites
 * Reads again, in memory and read-only, the subject, sender address, display
 * name and domain of every mail Iris remembers, then looks for each of them in
 * every row of every table Cénacle keeps. Prints counts and, for a hit, the
 * kind of value and the table — never the value: the report can be published.
 * A table the application role cannot read is reported as not checked, and
 * makes the measure fail: what is not searched is not proven clean.
 * Not covered here: OpenTelemetry traces (Tempo), Telegram messages already
 * sent, terminal output. Nothing is written anywhere.
 */
import { errorText, refuseForeignSecrets, SecretPlacementError } from "@cenacle/core";
import { connectOrQuit } from "@cenacle/journal";
import { findLeaks, type Haystack, type Needle, type NeedleKind, searchable } from "@cenacle/mail";
import { readBack } from "./mesure-lecture.ts";

refuseForeignSecrets("La mesure des fuites", ["mail"]);
const sql = connectOrQuit();
try {
  const { mails, gone } = await readBack(sql);
  const needles: Needle[] = mails.flatMap((m) => {
    const domain = m.from?.split("@")[1] ?? "";
    return [
      { kind: "objet", value: m.subject },
      { kind: "adresse", value: m.from ?? "" },
      { kind: "nom", value: m.fromName },
      { kind: "domaine", value: domain },
    ] satisfies Needle[];
  });
  const { kept, tooShort } = searchable(needles);
  const tables = await sql<{ name: string; readable: boolean }[]>`
    SELECT tablename AS name,
           has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'SELECT') AS readable
    FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const haystacks: Haystack[] = [];
  const scanned: string[] = [];
  for (const t of tables.filter((t) => t.readable)) {
    const rows = await sql<{ row: string }[]>`SELECT r::text AS row FROM ${sql(t.name)} r`;
    for (const r of rows) haystacks.push({ where: t.name, text: r.row });
    scanned.push(`${t.name} (${rows.length})`);
  }
  const unreadable = tables.filter((t) => !t.readable).map((t) => t.name);
  const leaks = findLeaks(needles, haystacks);
  const count = (kind: NeedleKind) => kept.filter((n) => n.kind === kind).length;

  console.log(`Mesure des fuites — ${new Date().toISOString().slice(0, 10)}`);
  console.log(
    `Mails relus sur le serveur : ${mails.length}${gone > 0 ? ` (${gone} introuvables)` : ""}`,
  );
  console.log(
    `Valeurs cherchées : ${count("objet")} objets, ${count("adresse")} adresses, ${count("nom")} noms, ${count("domaine")} domaines (${tooShort} trop courtes, non cherchées)`,
  );
  console.log(`Tables fouillées (lignes) : ${scanned.join(", ") || "aucune"}`);
  console.log(`Tables non lisibles : ${unreadable.join(", ") || "aucune"}`);
  for (const l of leaks) console.log(`  ✘ un ${l.kind} trouvé dans ${l.where}`);
  console.log(`Fuites : ${leaks.length}`);
  if (kept.length === 0) {
    console.error("🛑 rien à chercher : aucun mail relu, la mesure ne prouve rien");
    process.exitCode = 1;
  } else if (leaks.length > 0 || unreadable.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`🛑 ${errorText(error, [SecretPlacementError])}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
