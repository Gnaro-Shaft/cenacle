/**
 * Step 0 of sender authentication: what does the receiving server leave in
 * the mails? Read-only, headers only, counts only — no domain, no address, no
 * header value is printed. Servers come out as letters; give the name you read
 * in your webmail (the first word of an Authentication-Results header) with
 * --serveur to learn which letter it is, if any.
 *
 * Usage: npm run mail:auth-survey [-- --serveur=<name> --max=300]
 */
import { errorText, UsageError } from "@cenacle/core";
import { connectOrQuit, createPeople } from "@cenacle/journal";
import {
  authShape,
  KeyError,
  keyerFromEnv,
  loadCadre,
  MAX_SURVEYED,
  mailPassword,
  OUTCOMES,
  orderedHeaders,
  readingStartsAt,
  SURVEYED_METHODS,
  type Survey,
  scanAuthHeaders,
  senderAddress,
  summarize,
} from "@cenacle/mail";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const histogram = (h: Readonly<Record<number, number>>) =>
  Object.entries(h)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, n]) => `${k}→${n}`)
    .join(", ") || "—";

function print(s: Survey, opposed: number, beforeLimit: number): void {
  console.log(`✔ ${s.mails} mails lus (en-têtes seulement, lecture seule)`);
  if (opposed + beforeLimit > 0) {
    console.log(
      `  écartés sans être comptés : ${opposed} (opposition), ${beforeLimit} (avant la mention)`,
    );
  }
  console.log(`  Received par mail (nombre→mails) : ${histogram(s.receivedPerMail)}`);
  console.log(
    `  Authentication-Results : ${s.withAuthResults} mails en ont, ${s.mails - s.withAuthResults} aucun, ${s.unreadableAuthResults} avec un en-tête illisible`,
  );
  console.log(
    `  ARC-Authentication-Results : ${s.arc} — Received-SPF : ${s.receivedSpf} — From illisible : ${s.unreadableFrom} — blocs tronqués : ${s.truncated}`,
  );
  for (const v of s.servers) {
    const given = v.matchesGiven === true ? " — c'est le serveur donné" : "";
    console.log(
      `\n  Serveur ${v.label}${given} : ${v.mails} mails, en tête des A-R dans ${v.topmost}, répété dans ${v.repeated}`,
    );
    console.log(`    position (Received au-dessus→en-têtes) : ${histogram(v.positions)}`);
    for (const m of SURVEYED_METHODS) {
      const counts = OUTCOMES.filter((o) => v.outcomes[m][o] > 0)
        .map((o) => `${o} ${v.outcomes[m][o]}`)
        .join(", ");
      console.log(`    ${m.padEnd(5)} : ${counts} — pass aligné sur le From : ${v.aligned[m]}`);
    }
  }
  if (s.otherServerMails > 0) console.log(`\n  autres serveurs : ${s.otherServerMails} mails`);
  if (s.givenSeen === false) console.log("\n⚠ le serveur donné n'apparaît dans aucun mail lu");
  if (s.givenSeen === null) {
    console.log("\nℹ --serveur=<nom> pour savoir quelle lettre est votre serveur");
  }
}

const sql = connectOrQuit();
try {
  const max = Number(option("max") ?? "300");
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_SURVEYED) {
    throw new UsageError(`--max doit être un entier entre 1 et ${MAX_SURVEYED}`);
  }
  const cadre = loadCadre();
  const keyer = keyerFromEnv();
  // C3: an opposed person's mails are not counted either.
  const opposedKeys = await createPeople(sql).opposedKeys();
  const scan = await scanAuthHeaders(
    cadre.mail,
    mailPassword(cadre),
    { notBefore: readingStartsAt(cadre), newest: max },
    (raw) => {
      const { fields, truncated } = orderedHeaders(raw);
      const froms = fields.filter((f) => f.name === "from");
      const sender = froms.length === 1 ? senderAddress(froms[0]?.value) : null;
      return {
        opposed: sender !== null && opposedKeys.has(keyer.address(sender)),
        shape: authShape(fields, truncated),
      };
    },
  );
  const kept = scan.mails.filter((m) => !m.opposed).map((m) => m.shape);
  print(summarize(kept, option("serveur")), scan.mails.length - kept.length, scan.beforeLimit);
} catch (error) {
  console.error(`🛑 ${errorText(error, [KeyError])}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
