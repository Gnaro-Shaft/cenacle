/**
 * The CI's dependency audit (npm run deps:audit): `npm audit` at the high
 * level, minus a short list of advisories set aside by hand — npm has no way
 * to set one aside. An exception holds for one advisory, named by its GHSA
 * id, on the packages it names; only while no fix can be taken without a
 * major change (the day one exists, the audit fails again, and the fix is
 * taken); and only until its date (then it is looked at again, and renewed
 * or dropped). An exception whose advisory is gone fails too: the list stays
 * true. The report is read whole, here: a gate must not skip what it cannot
 * name — anything unexpected blocks.
 */
import { spawnSync } from "node:child_process";
import { advisoryText } from "@cenacle/securite";

export interface AuditException {
  /** The advisory's GHSA id. */
  readonly ghsa: string;
  /** The packages it is set aside on: the same advisory anywhere else blocks. */
  readonly packages: readonly string[];
  /** Why it may wait, in a sentence. */
  readonly raison: string;
  /** Set aside until this day (YYYY-MM-DD, UTC), included. */
  readonly jusqua: string;
}

// GHSA-fc5q-39xc-vjpf (picomatch), set aside on 17/11/2026, was withdrawn by
// GitHub on 18/11: nothing left to set aside.
export const EXCEPTIONS: readonly AuditException[] = [];

export interface AuditVerdict {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** The severities that do not block; any other, even one npm adds later, does. */
const PASSING = new Set(["info", "low", "moderate"]);
const GHSA_URL = /^https:\/\/github\.com\/advisories\/(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNREADABLE: AuditVerdict = {
  ok: false,
  lines: ["✗ npm audit n'a pas rendu de rapport lisible : rien n'est jugé"],
};

const record = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/**
 * A fix that needs no major change: `npm audit fix`, or a bump within the
 * major of a parent. Anything but « none » or « a major one » counts as one.
 */
function fixable(fix: unknown): boolean {
  if (fix === false) return false;
  return record(fix)?.isSemVerMajor !== true;
}

/** The audit's verdict on `npm audit --json`'s output, `today` being a YYYY-MM-DD day. */
export function judgeAudit(
  raw: string,
  exceptions: readonly AuditException[],
  today: string,
): AuditVerdict {
  if (!DAY.test(today) || exceptions.some((e) => !DAY.test(e.jusqua))) {
    return { ok: false, lines: ["✗ une date n'est pas au format AAAA-MM-JJ : rien n'est jugé"] };
  }
  let data: Record<string, unknown> | null;
  try {
    data = record(JSON.parse(raw));
  } catch {
    return UNREADABLE;
  }
  const vulnerabilities = record(data?.vulnerabilities);
  if (vulnerabilities === null) return UNREADABLE;

  const lines: string[] = [];
  let ok = true;
  const used = new Set<AuditException>();
  const said = new Set<string>();
  const say = (line: string) => {
    if (!said.has(line)) lines.push(line);
    said.add(line);
  };
  for (const [pkg, entry] of Object.entries(vulnerabilities)) {
    const v = record(entry);
    if (v === null || !Array.isArray(v.via)) {
      ok = false;
      say(`✗ ${JSON.stringify(pkg).slice(0, 80)} : entrée illisible dans le rapport`);
      continue;
    }
    for (const via of v.via) {
      if (typeof via === "string") continue; // a path through another package, judged there
      const a = record(via);
      if (a !== null && PASSING.has(String(a.severity))) continue;
      const ghsa = GHSA_URL.exec(String(a?.url))?.[1];
      const name = JSON.stringify(pkg).slice(0, 80);
      const id = ghsa ?? `avis ${String(a?.source).slice(0, 20)}`;
      const exception =
        ghsa === undefined
          ? undefined
          : exceptions.find((e) => e.ghsa === ghsa && e.packages.includes(pkg));
      if (exception === undefined) {
        ok = false;
        const words = advisoryText(a?.title) ?? "texte de l'avis non affiché";
        say(`✗ ${String(a?.severity).slice(0, 20)} dans ${name} : ${words} (${id})`);
        continue;
      }
      used.add(exception);
      if (today > exception.jusqua) {
        ok = false;
        say(`✗ ${id} (${pkg}) était écarté jusqu'au ${exception.jusqua} : à revoir`);
      } else if (fixable(v.fixAvailable)) {
        ok = false;
        say(`✗ ${id} (${pkg}) a désormais un correctif : le prendre, et lever l'exception`);
      } else {
        say(`· ${id} (${pkg}) écarté jusqu'au ${exception.jusqua} : ${exception.raison}`);
      }
    }
  }
  for (const e of exceptions) {
    if (!used.has(e)) {
      ok = false;
      say(`✗ l'exception ${e.ghsa} ne sert plus : la retirer`);
    }
  }
  if (ok) lines.push("✔ Audit des dépendances : rien d'élevé ni de critique hors exceptions");
  return { ok, lines };
}

if (import.meta.main) {
  const run = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 256 << 20 });
  const verdict = judgeAudit(run.stdout ?? "", EXCEPTIONS, new Date().toISOString().slice(0, 10));
  for (const line of verdict.lines) console.log(line);
  process.exitCode = verdict.ok ? 0 : 1;
}
