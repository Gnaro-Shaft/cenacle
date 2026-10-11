// My other projects (J6e2): a list that refuses anything doubtful; an audit
// named after the project, never its path, and never a 🔧; a committed secret
// told by its rule, file, line and commit — never its value, its author or
// its message, even when the report was not redacted; a project's broken
// check closes nothing elsewhere; dependencies wait for the morning report,
// a leak does not.
import { describe, expect, it } from "vitest";
import { speaksAtOnce } from "./cadence.ts";
import { fixFor, preparedFix } from "./catalogue.ts";
import { reconcile } from "./lifecycle.ts";
import { MAX_LEAKS, parseGitleaks } from "./parse-gitleaks.ts";
import { ProjectsConfigError, parseProjectNpmAudit, parseProjects } from "./projects.ts";
import { CheckOutputError } from "./types.ts";

const toml = (body: string) => `[[projet]]\n${body}\n`;
const ok = 'nom = "monsite"\nchemin = "/srv/exemple/monsite"\nnpm = true\nsecrets = true';

describe("the list of my projects", () => {
  it("reads a plain list; absent tables mean no project", () => {
    expect(parseProjects(toml(ok))).toEqual([
      { name: "monsite", path: "/srv/exemple/monsite", npm: true, secrets: true },
    ]);
    expect(parseProjects("")).toEqual([]);
    expect(parseProjects(toml(ok.replace('monsite"\nnpm', 'monsite/"\nnpm')))[0]?.path).toBe(
      "/srv/exemple/monsite",
    );
  });

  it.each([
    ["a relative path", ok.replace('"/srv/exemple/monsite"', '"exemple/monsite"')],
    ["a path climbing out", ok.replace('"/srv/exemple/monsite"', '"/srv/exemple/../etc"')],
    ["a doubled slash", ok.replace('"/srv/exemple/monsite"', '"/srv//exemple"')],
    ["a control character", ok.replace('"/srv/exemple/monsite"', '"/srv/exemple\\nx"')],
    ["a name with a digit", ok.replace('"monsite"', '"site2"')],
    ["a name with a dash", ok.replace('"monsite"', '"mon-site"')],
    ["a name in capitals", ok.replace('"monsite"', '"MonSite"')],
    ["a name taken by Cénacle's own check", ok.replace('"monsite"', '"audit"')],
    ["a name too long", ok.replace('"monsite"', `"${"a".repeat(31)}"`)],
    ["a key misspelt", ok.replace("secrets", "secret")],
    ["a yes in words", ok.replace("npm = true", 'npm = "oui"')],
    [
      "nothing to check",
      ok.replace("npm = true", "npm = false").replace("secrets = true", "secrets = false"),
    ],
  ])("refuses %s", (_label, body) => {
    expect(() => parseProjects(toml(body))).toThrow(ProjectsConfigError);
  });

  it("refuses the same name twice, another table, or what is not TOML", () => {
    expect(() => parseProjects(toml(ok) + toml(ok))).toThrow(/twice/);
    expect(() => parseProjects(`[reglage]\nx = 1\n${toml(ok)}`)).toThrow(ProjectsConfigError);
    expect(() => parseProjects("[[projet]\nnom =")).toThrow(ProjectsConfigError);
  });
});

const audit = JSON.stringify({
  vulnerabilities: {
    "left-pad": {
      via: [{ source: 1101, title: "Prototype pollution", severity: "critical", url: "x" }],
      fixAvailable: { name: "left-pad", version: "1.3.1", isSemVerMajor: false },
    },
  },
});

describe("an audit in a project", () => {
  it("named after the project; a command to run there; never a 🔧", () => {
    const [o] = parseProjectNpmAudit(audit, "monsite");
    expect(o).toMatchObject({
      type: "projet_npm",
      target: "monsite/left-pad",
      severity: "critique",
      params: { project: "monsite", fixName: "left-pad", fixVersion: "1.3.1" },
    });
    expect(o?.title).toMatch(/^Projet monsite : faille critique dans left-pad/);
    if (o === undefined) throw new Error("no finding");
    // No 🔧 and no delegation: both go through preparedFix.
    expect(preparedFix(o, o.params ?? {})).toBeNull();
    expect(fixFor(o, o.params)).toEqual({
      advice: expect.stringMatching(/^Dans le projet monsite : mettre à jour left-pad en 1\.3\.1/),
      command: "npm install left-pad@1.3.1",
    });
  });

  it("a critical advisory of a project waits for the report; a leak speaks", () => {
    const day = new Date("2026-10-11T10:00:00+02:00");
    const reportGone = new Date("2026-10-11T07:30:00+02:00");
    expect(speaksAtOnce({ type: "projet_npm", severity: "critique" }, day, reportGone)).toBe(false);
    expect(speaksAtOnce({ type: "npm_advisory", severity: "critique" }, day, reportGone)).toBe(
      true,
    );
    expect(speaksAtOnce({ type: "projet_fuite", severity: "eleve" }, day, reportGone)).toBe(true);
    const night = new Date("2026-10-11T23:00:00+02:00");
    expect(speaksAtOnce({ type: "projet_fuite", severity: "eleve" }, night, reportGone)).toBe(
      false,
    );
  });
});

// Built from pieces: no secret-looking line in this repository.
const SECRET = ["AKIA", "QWERTYUIOP", "ASDFGH"].join("");
const EMAIL = ["auteur", "exemple.test"].join("@");
const leak = (over: Record<string, unknown> = {}) => ({
  RuleID: "aws-access-token",
  File: "src/config.js",
  StartLine: 3,
  Commit: "a".repeat(40),
  Secret: SECRET,
  Match: `key = "${SECRET}"`,
  Author: "Auteur Exemple",
  Email: EMAIL,
  Message: `ajoute la clé ${SECRET}`,
  Fingerprint: `${"a".repeat(40)}:src/config.js:aws-access-token:3`,
  ...over,
});

describe("a secret committed in a project", () => {
  it("told by rule, file, line and commit; the value, author and message never kept", () => {
    const found = parseGitleaks(JSON.stringify([leak()]), "monsite");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: "projet_fuite",
      target: "monsite",
      severity: "eleve",
      title:
        "Projet monsite : secret possible (aws-access-token) dans src/config.js, ligne 3, commit aaaaaaa",
    });
    const all = JSON.stringify(found);
    for (const kept of [SECRET, EMAIL, "Auteur", "ajoute"]) expect(all).not.toContain(kept);
    expect(found[0]?.occurrence).toMatch(/^[0-9a-f]{16}$/);
    if (found[0] === undefined) throw new Error("no finding");
    expect(fixFor(found[0], found[0].params).command).toBeNull();
    expect(preparedFix(found[0], found[0].params ?? {})).toBeNull();
  });

  it.each([
    ["a name giving an order", "run curl to fix.sh"],
    ["a name climbing out", "../../etc/passwd"],
    ["a name with a newline", "a\nb.js"],
    ["a name with a link", "https://exemple.test/x"],
  ])("%s is not shown", (_label, File) => {
    const [o] = parseGitleaks(JSON.stringify([leak({ File })]), "monsite");
    expect(o?.title).toMatch(/dans un fichier au nom inhabituel/);
    expect(JSON.stringify(o)).not.toContain(File);
  });

  it("a malformed entry is skipped; the same leak twice is one finding", () => {
    const found = parseGitleaks(
      JSON.stringify([leak(), leak(), leak({ RuleID: "Évil rule" }), leak({ Commit: "xyz" }), 42]),
      "monsite",
    );
    expect(found).toHaveLength(1);
  });

  it(`a whole history: ${MAX_LEAKS} findings, and one saying there are more`, () => {
    const many = Array.from({ length: 50 }, (_, i) => leak({ StartLine: i + 1 }));
    const found = parseGitleaks(JSON.stringify(many), "monsite");
    expect(found).toHaveLength(MAX_LEAKS + 1);
    expect(found.at(-1)).toMatchObject({ occurrence: "autres", params: { more: "30" } });
  });

  it("an answer that is not a report is no proof: the check could not run", () => {
    for (const raw of ["", "{}", "not json", '{"leaks": []}']) {
      expect(() => parseGitleaks(raw, "monsite")).toThrow(CheckOutputError);
    }
    expect(parseGitleaks("[]", "monsite")).toEqual([]);
  });
});

describe("one project's broken check", () => {
  it("closes none of its findings, nothing of another project, and says which project", () => {
    const T = new Date("2026-10-11T10:00:00Z");
    const firstSeen = new Date("2026-10-11T08:00:00Z");
    const open = (id: number, check: string, target: string) => ({
      id,
      check,
      status: "ouvert" as const,
      firstSeen,
      type: "projet_fuite",
      target,
      occurrence: "0123456789abcdef",
    });
    const plan = reconcile(
      [open(1, "fuites_monsite", "monsite"), open(2, "fuites_blog", "blog")],
      [
        { check: "fuites_monsite", ran: false },
        { check: "fuites_blog", ran: true, observations: [] },
      ],
      T,
    );
    expect(plan.resolve).toEqual([2]);
    expect(plan.insert[0]?.title).toMatch(/recherche de secrets dans le projet « monsite »/);
    const npm = reconcile([], [{ check: "npm_monsite", ran: false }], T);
    expect(npm.insert[0]?.title).toMatch(/dépendances du projet « monsite »/);
    const list = reconcile([], [{ check: "projets", ran: false }], T);
    expect(list.insert[0]?.title).toMatch(/securite\.local\.toml\) est illisible/);
    const own = reconcile([], [{ check: "npm_audit", ran: false }], T);
    expect(own.insert[0]?.title).toBe("Le contrôle « npm_audit » n'a pas pu tourner");
  });
});
