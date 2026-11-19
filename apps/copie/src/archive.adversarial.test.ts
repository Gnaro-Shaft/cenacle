// ADR-0044, point 7: a copy is not trusted. What pg_restore writes from it is
// judged line by line: a real copy's shape passes, anything else — another
// table, a statement, a psql command, a sequence of another table, a table
// twice or missing — and nothing is reloaded. The key reaches age by its
// input alone: never an argument, never the environment. The file is checked
// before the key is even asked.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCopyFile, decrypt, judgeScript } from "./archive.ts";

const DIR = mkdtempSync(join(tmpdir(), "cenacle-archive-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const KEY_LINE = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
const RAPPELS = "COPY public.rappels (id, texte, echeance) FROM stdin;";

/** A script as pg_restore writes one from a real copy (seen on 19/11, PostgreSQL 18). */
function script(change: (lines: string[]) => string[] = (l) => l): string {
  const block = (table: string, cols: string, rows: string[] = []) => [
    "",
    `-- Data for Name: ${table}; Type: TABLE DATA; Schema: public; Owner: cenacle_owner`,
    "",
    `COPY public.${table} (${cols}) FROM stdin;`,
    ...rows,
    "\\.",
  ];
  const lines = [
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    "\\restrict Qw81Khuko7p04aGn",
    "",
    "SET statement_timeout = 0;",
    "SET client_encoding = 'UTF8';",
    "SET standard_conforming_strings = on;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "SET row_security = off;",
    ...block("prospection_cartes", "id, source, title"),
    // Data that looks like SQL, or like a psql command, is data: COPY reads it.
    ...block("rappels", "id, texte, echeance", [
      "1\tDROP TABLE events; \\! rm -rf /\t2026-11-20 08:06:25+00",
      "2\t\\\\unrestrict x\t2026-11-21 08:06:25+00",
    ]),
    ...block("securite_constats", "id, type, target"),
    ...block("veille_articles", "id, sent_at, link"),
    "",
    "SELECT pg_catalog.setval('public.prospection_cartes_id_seq', 1, false);",
    "SELECT pg_catalog.setval('public.rappels_id_seq', 2, true);",
    "SELECT pg_catalog.setval('public.securite_constats_id_seq', 1, false);",
    "SELECT pg_catalog.setval('public.veille_articles_id_seq', 1, false);",
    "",
    "\\unrestrict Qw81Khuko7p04aGn",
    "",
  ];
  return change(lines).join("\n");
}

const replace = (from: string, to: string[]) => (lines: string[]) =>
  lines.flatMap((l) => (l === from ? to : [l]));
const insertAfter = (at: string, add: string[]) => (lines: string[]) =>
  lines.flatMap((l) => (l === at ? [l, ...add] : [l]));
const SET = "SET row_security = off;";

describe("judgeScript: a real copy's shape, and nothing else", () => {
  it("passes a real copy: four tables, their columns, their sequences", () => {
    const content = judgeScript(script());
    expect([...content.columns.keys()].sort()).toEqual([
      "prospection_cartes",
      "rappels",
      "securite_constats",
      "veille_articles",
    ]);
    expect(content.columns.get("rappels")).toEqual(["id", "texte", "echeance"]);
    expect(content.sequences.get("rappels_id_seq")).toEqual({ value: "2", called: true });
  });

  // Where psql would read a line otherwise than the judge (review of 19/11):
  // psql ends a COPY on "\.\r" — checked on the real psql, a forged statement ran.
  const MARK_ROW = "1\tDROP TABLE events; \\! rm -rf /\t2026-11-20 08:06:25+00";
  const desync: [string, (l: string[]) => string[]][] = [
    ["the end of a COPY with a carriage return", insertAfter(MARK_ROW, ["\\.\r", "DROP TABLE x;"])],
    ["a carriage return anywhere", replace(SET, ["SET row_security = off;\r"])],
    ["a NUL byte", replace(MARK_ROW, [`${MARK_ROW}\u0000`])],
    ["a data line beginning with the end mark", insertAfter(MARK_ROW, ["\\.x"])],
    ["a quote left open", replace(SET, ["SET lock_timeout = '0;"])],
    ["no \\restrict guard", (l) => l.filter((x) => !/^\\(un)?restrict /.test(x))],
    ["a statement before the guard", (l) => [SET, ...l]],
  ];

  it.each(desync)("refuses %s", (_what, change) => {
    expect(() => judgeScript(script(change))).toThrow(/autre chose que les quatre tables/);
  });

  const forged: [string, (l: string[]) => string[]][] = [
    ["another table", insertAfter(SET, ["COPY public.events (id, payload) FROM stdin;", "\\."])],
    [
      "the mails read, left out of the copy",
      insertAfter(SET, ["COPY public.prospection_mails_lus (id) FROM stdin;", "\\."]),
    ],
    [
      "a table of another schema",
      replace(RAPPELS, ["COPY other.rappels (id, texte, echeance) FROM stdin;"]),
    ],
    ["a statement", insertAfter(SET, ["DROP TABLE public.events;"])],
    ["a statement after a block", insertAfter("\\.", ["UPDATE public.rappels SET texte = 'x';"])],
    ["a shell command of psql", insertAfter(SET, ["\\! touch /tmp/pwned"])],
    ["another psql command", insertAfter(SET, ["\\c postgres"])],
    ["a role switched", insertAfter(SET, ["SET session_authorization = 'postgres';"])],
    ["a role switched (SET role)", insertAfter(SET, ["SET role = cenacle_admin;"])],
    [
      "another table's sequence",
      insertAfter(SET, ["SELECT pg_catalog.setval('public.events_id_seq', 9, true);"]),
    ],
    [
      "a setval followed by a statement",
      replace("SELECT pg_catalog.setval('public.rappels_id_seq', 2, true);", [
        "SELECT pg_catalog.setval('public.rappels_id_seq', 2, true); DROP TABLE events;",
      ]),
    ],
    ["a table twice", insertAfter(SET, ["COPY public.rappels (id) FROM stdin;", "\\."])],
    [
      "a sequence twice",
      insertAfter(SET, ["SELECT pg_catalog.setval('public.rappels_id_seq', 5, true);"]),
    ],
    [
      "a table missing",
      (l) => {
        const at = l.indexOf("COPY public.veille_articles (id, sent_at, link) FROM stdin;");
        return [...l.slice(0, at), ...l.slice(at + 2)];
      },
    ],
    ["a sequence missing", (l) => l.filter((x) => !x.includes("veille_articles_id_seq"))],
    ["a block never closed", (l) => l.slice(0, l.indexOf("\\."))],
    ["anything after the guard is lifted", (l) => [...l, "DROP TABLE public.events;"]],
    ["the guard lifted early", insertAfter(SET, ["\\unrestrict Qw81Khuko7p04aGn"])],
    [
      "the guard lifted with another key",
      replace("\\unrestrict Qw81Khuko7p04aGn", ["\\unrestrict autre"]),
    ],
    ["the guard never lifted", (l) => l.filter((x) => !x.startsWith("\\unrestrict"))],
    ["a second guard", insertAfter(SET, ["\\restrict autre"])],
    [
      "a column that is not a name",
      replace(RAPPELS, ["COPY public.rappels (id, (select 1)) FROM stdin;"]),
    ],
    ["COPY from a program", replace(RAPPELS, ["COPY public.rappels (id) FROM PROGRAM 'id';"])],
    // Four for four: the count alone would not see a swap.
    [
      "a table in place of another",
      replace("COPY public.veille_articles (id, sent_at, link) FROM stdin;", [
        "COPY public.events (id, sent_at, link) FROM stdin;",
      ]),
    ],
    [
      "a sequence in place of another",
      replace("SELECT pg_catalog.setval('public.veille_articles_id_seq', 1, false);", [
        "SELECT pg_catalog.setval('public.events_id_seq', 1, false);",
      ]),
    ],
    [
      "a sequence named like none",
      replace("SELECT pg_catalog.setval('public.veille_articles_id_seq', 1, false);", [
        "SELECT pg_catalog.setval('public.veille_articles', 1, false);",
      ]),
    ],
    [
      "a reload after the guard is lifted",
      (l) => [
        ...l.filter((x) => !x.includes("veille_articles_id_seq")),
        "SELECT pg_catalog.setval('public.veille_articles_id_seq', 1, false);",
      ],
    ],
    [
      "the last block left open, all else there",
      (l) => {
        const kept = l.filter((x) => !/^\\(un)?restrict /.test(x));
        const setvals = kept.filter((x) => x.includes("pg_catalog.setval"));
        const rest = kept.filter((x) => !x.includes("pg_catalog.setval"));
        const lastClose = rest.lastIndexOf("\\.");
        const at = rest.indexOf("COPY public.veille_articles (id, sent_at, link) FROM stdin;");
        return [...rest.slice(0, at), ...setvals, ...rest.slice(at, lastClose)];
      },
    ],
  ];

  it.each(forged)("refuses %s, saying nothing of the copy", (_what, change) => {
    const forgedScript = script(change);
    expect(() => judgeScript(forgedScript)).toThrow(/autre chose que les quatre tables/);
    try {
      judgeScript(forgedScript);
    } catch (error) {
      expect(String(error)).not.toMatch(/events|pwned|DROP|session|PROGRAM/);
    }
  });
});

describe("checkCopyFile: before the key is asked", () => {
  it("refuses a missing file, a folder, a file that is not age's, one past 256 MB", () => {
    expect(() => checkCopyFile(join(DIR, "absente.age"))).toThrow(/introuvable/);
    mkdirSync(join(DIR, "dossier.age"));
    expect(() => checkCopyFile(join(DIR, "dossier.age"))).toThrow(/fichier ordinaire/);
    writeFileSync(join(DIR, "clair.age"), "PGDMP en clair");
    expect(() => checkCopyFile(join(DIR, "clair.age"))).toThrow(/pas une copie chiffrée/);
    const big = join(DIR, "grosse.age");
    writeFileSync(big, "age-encryption.org/v1\n");
    truncateSync(big, 256 * 1024 * 1024 + 1);
    expect(() => checkCopyFile(big)).toThrow(/256 Mo/);
    writeFileSync(join(DIR, "bonne.age"), "age-encryption.org/v1\n-> X25519 x\n");
    expect(() => checkCopyFile(join(DIR, "bonne.age"))).not.toThrow();
  });
});

describe("decrypt: the key on age's input, nowhere else", () => {
  // A stand-in for age that notes its arguments, its environment and its input.
  const fakeAge = join(DIR, "faux-age");
  const notes = join(DIR, "notes");
  writeFileSync(
    fakeAge,
    `#!/bin/sh\n{ echo "ARGS $*"; env; echo "STDIN"; cat; } > ${notes}\nprintf 'PGDMP'\n`,
  );
  chmodSync(fakeAge, 0o755);

  it("gives the key on the input, never in an argument or the environment", async () => {
    const out = await decrypt(fakeAge, KEY_LINE, join(DIR, "copie.age"));
    expect(out.toString()).toBe("PGDMP");
    const [before, input] = readFileSync(notes, "utf8").split("STDIN\n");
    expect(before).not.toContain(KEY_LINE);
    expect(before).toMatch(/ARGS --decrypt --identity - /);
    expect(input).toBe(`${KEY_LINE}\n`);
  });

  it("refuses what is not a key before age runs", async () => {
    rmSync(notes, { force: true });
    await expect(decrypt(fakeAge, "AGE-SECRET-KEY-1court", "x")).rejects.toThrow(/pas une clé/);
    await expect(decrypt(fakeAge, `${KEY_LINE}\nautre`, "x")).rejects.toThrow(/pas une clé/);
    expect(() => readFileSync(notes)).toThrow();
  });

  it("a key that does not open the copy: nothing comes out, said plainly", async () => {
    const refusing = join(DIR, "faux-age-refus");
    writeFileSync(refusing, "#!/bin/sh\ncat >/dev/null\necho 'no identity matched' >&2\nexit 1\n");
    chmodSync(refusing, 0o755);
    await expect(decrypt(refusing, KEY_LINE, "x")).rejects.toThrow(/ne déchiffre pas/);
  });
});
