// The real bulletin script, version 3 (ADR-0043), in a throwaway Debian
// container (no network), with backup verdicts shaped as each writer writes
// them (Legion's copie-dumps, veiller-les-sauvegardes and copie-bases,
// Myriade's tirer-la-base, read on 17/11/2026). What is checked: a motif's
// text never leaves the server — not its addresses, not its host names —
// only the verdict, its instant, since when and how many motifs; a verdict
// out of its source's shape, a link, a file the account cannot read are
// "illisible", never a verdict; and nothing goes through sudo.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_BULLETIN, parseBulletin } from "./bulletin.ts";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "deploy",
  "serveurs",
  "cenacle-bulletin",
);
const IMAGE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";
const DIR = mkdtempSync(join(tmpdir(), "cenacle-bulletin-v3-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// What a motif may carry, and must never leave the server.
const LEAKS = ["192.0.2", "hote-exemple", "tailnet", "rsync", "ssh", "sqlite", "nœud-a"];
const v = (...lines: string[]) => `${lines.join("\n")}\n`;
const SAIN = {
  "copie-dumps": v(
    "verdict=SAIN",
    "instant=1794900000",
    "depuis=-",
    "libre_go=120",
    "pool_pct=64",
    "gardees=21",
    "controles=3",
    "corrompus=0",
    "invite=100:3",
    "invite=500:3",
    "fin=1",
  ),
  "veiller-sauvegardes": v(
    "verdict=SAIN",
    "instant=1794900000",
    "depuis=-",
    "invites=100,200,500",
    "noeud=nœud-a:OK:1794890000",
    "noeud=nœud-b:OK:1794890000",
    "fin=1",
  ),
  "copie-bases": v(
    "verdict=SAIN",
    "instant=1794900000",
    "depuis=-",
    "libre_go=40",
    "gardes=7",
    "controles=12",
    "fautifs=0",
    "ecrit_le=1794880000",
    "jeu=2026-11-16:4",
    "fin=1",
  ),
  "myriade-base": v(
    "verdict=SAIN",
    "instant=1794900000",
    "depuis=-",
    "chiffre=age",
    "dernier=myriade-2026-11-16.dump.age",
    "taille_octets=123456",
    "gardes=7",
    "elagues=1",
    "fin=1",
  ),
};
const MALADE = {
  "copie-dumps": v(
    "verdict=MALADE",
    "instant=1794900000",
    "depuis=1794800000",
    "libre_go=-",
    "pool_pct=95",
    "gardees=18",
    "controles=2",
    "corrompus=1",
    "invite=100:2",
    "motif=rsync a échoué (code 255) : ssh: connect to host 192.0.2.7 port 22 · hote-exemple.tailnet-exemple.ts.net",
    "motif=pool LVM plein à 95 %",
    "fin=1",
  ),
  "veiller-sauvegardes": v(
    "verdict=MALADE",
    "instant=1794900000",
    "depuis=1794700000",
    "invites=100,200",
    "motif=nœud-a : ses taches sont illisibles — 192.0.2.9 ne répond pas",
    "fin=1",
  ),
  "copie-bases": v(
    "verdict=MALADE",
    "instant=1794900000",
    "depuis=1794890000",
    "libre_go=40",
    "gardes=6",
    "controles=12",
    "fautifs=1",
    "ecrit_le=-",
    "jeu=2026-11-16:4",
    "motif=2026-11-16/x.db : *** sqlite: malformed on hote-exemple",
    "fin=1",
  ),
  "myriade-base": v(
    "verdict=MALADE",
    "instant=1794900000",
    "depuis=1794900000",
    "motif=le tirage a échoué (code 255) : ssh: Could not resolve hostname hote-exemple",
    "fin=1",
  ),
};

let runs = 0;
/**
 * Runs the script in a fresh container: each verdict placed under
 * /var/lib/<source>/verdict by `setup` (as root), then the script run as an
 * ordinary account (nobody), as the cenacle account would.
 */
function recite(verdicts: Record<string, string>, setup = ""): string {
  const fx = join(DIR, `fx-${runs++}`);
  mkdirSync(fx);
  const place: string[] = [];
  for (const [source, text] of Object.entries(verdicts)) {
    writeFileSync(join(fx, source), text);
    place.push(
      `mkdir -p /var/lib/${source} && cp /fx/${source} /var/lib/${source}/verdict && chmod 644 /var/lib/${source}/verdict`,
    );
  }
  const run = [...place, setup, "exec setpriv --reuid=65534 --regid=65534 --clear-groups bash /b"]
    .filter((l) => l !== "")
    .join(" && ");
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      `${SCRIPT}:/b:ro`,
      "-v",
      `${fx}:/fx:ro`,
      IMAGE,
      "bash",
      "-c",
      run,
    ],
    { encoding: "utf8" },
  );
}
const one = (source: string, text: string, setup = "") =>
  parseBulletin(recite({ [source]: text }, setup)).backups;

describe("cenacle-bulletin version 3: the backups on the machine", () => {
  it("four healthy sources: verdict and instant, healthy since nothing, no motif", () => {
    const text = recite(SAIN);
    const b = parseBulletin(text);
    expect(b.version).toBe(3);
    expect(b.backups).toEqual(
      ["copie-dumps", "veiller-sauvegardes", "copie-bases", "myriade-base"].map((source) => ({
        source,
        read: "ok",
        verdict: "SAIN",
        at: 1_794_900_000_000,
        since: null,
        motifs: 0,
      })),
    );
    expect(text.length).toBeLessThan(MAX_BULLETIN);
  }, 120_000);

  it("four ill sources: since when and how many motifs — never a motif's text", () => {
    const text = recite(MALADE);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
    const b = parseBulletin(text);
    expect(
      b.backups?.map((s) => (s.read === "ok" ? [s.verdict, s.since, s.motifs] : s.read)),
    ).toEqual([
      ["MALADE", 1_794_800_000_000, 2],
      ["MALADE", 1_794_700_000_000, 1],
      ["MALADE", 1_794_890_000_000, 1],
      ["MALADE", 1_794_900_000_000, 1],
    ]);
  }, 120_000);

  it("a machine without backups recites none", () => {
    expect(parseBulletin(recite({})).backups).toEqual([]);
  }, 120_000);

  const sain = SAIN["copie-dumps"];
  // A key each source does not write (it belongs to another).
  const FOREIGN: Record<string, string> = {
    "copie-dumps": "jeu=2026-11-16:4",
    "veiller-sauvegardes": "gardes=7",
    "copie-bases": "invite=100:3",
    "myriade-base": "noeud=nœud-a:OK:1794890000",
  };
  it.each([
    [
      "a key of another source",
      (s: string, t: string) => t.replace("fin=1", `${FOREIGN[s]}\nfin=1`),
    ],
    [
      "a key said twice that may not be",
      (_s: string, t: string) => t.replace("fin=1", "verdict=SAIN\nfin=1"),
    ],
    ["a line after fin=1", (_s: string, t: string) => `${t}motif=late\n`],
    ["no fin=1", (_s: string, t: string) => t.replace("fin=1\n", "")],
    ["no depuis at all", (_s: string, t: string) => t.replace("depuis=-\n", "")],
    [
      "an instant out of shape",
      (_s: string, t: string) => t.replace("instant=1794900000", "instant=17949e5"),
    ],
    [
      "a depuis neither a number nor -",
      (_s: string, t: string) => t.replace("depuis=-", "depuis=hier"),
    ],
    [
      "ill after its own instant",
      (_s: string, t: string) => t.replace("depuis=-", "depuis=1794900001"),
    ],
    [
      "a verdict of a third word",
      (_s: string, t: string) => t.replace("verdict=SAIN", "verdict=SOUFFRANT"),
    ],
    ["an empty line", (_s: string, t: string) => t.replace("depuis=-\n", "depuis=-\n\n")],
    [
      "a carriage return",
      (_s: string, t: string) => t.replace("verdict=SAIN\n", "verdict=SAIN\r\n"),
    ],
  ])(
    "%s, for each of the four sources: illisible, and nothing of it said",
    (_what, spoil) => {
      const spoilt = Object.fromEntries(Object.entries(SAIN).map(([s, t]) => [s, spoil(s, t)]));
      for (const [s, t] of Object.entries(spoilt))
        expect(t, s).not.toBe(SAIN[s as keyof typeof SAIN]);
      expect(parseBulletin(recite(spoilt)).backups).toEqual(
        Object.keys(SAIN).map((source) => ({ source, read: "illisible" })),
      );
    },
    120_000,
  );

  it("a motif over several lines (an error quoted whole) stays one motif, and none of it is said", () => {
    const text = MALADE["veiller-sauvegardes"].replace(
      "ne répond pas\n",
      "ne répond pas\n  at /usr/share/perl5/PVE/RPC.pm line 12.\nparam=valeur via 192.0.2.11\n\n",
    );
    const raw = recite({ "veiller-sauvegardes": text });
    for (const leak of ["perl5", "param", "192.0.2"]) expect(raw).not.toContain(leak);
    expect(parseBulletin(raw).backups).toEqual([
      {
        source: "veiller-sauvegardes",
        read: "ok",
        verdict: "MALADE",
        at: 1_794_900_000_000,
        since: 1_794_700_000_000,
        motifs: 1,
      },
    ]);
  }, 120_000);

  it("a verdict file that is a link is not followed", () => {
    const setup =
      "mkdir -p /srv/x && mv /var/lib/copie-dumps/verdict /srv/x/v && ln -s /srv/x/v /var/lib/copie-dumps/verdict";
    expect(one("copie-dumps", sain, setup)).toEqual([{ source: "copie-dumps", read: "illisible" }]);
  }, 120_000);

  it("a folder that is a link is not followed", () => {
    const setup =
      "mv /var/lib/copie-dumps /srv/ailleurs && ln -s /srv/ailleurs /var/lib/copie-dumps";
    expect(one("copie-dumps", sain, setup)).toEqual([{ source: "copie-dumps", read: "illisible" }]);
  }, 120_000);

  it.each([
    ["a file only root reads", "chmod 600 /var/lib/copie-dumps/verdict"],
    ["a folder only root enters", "chmod 700 /var/lib/copie-dumps"],
  ])(
    "%s: illisible for the account, never absent",
    (_what, setup) => {
      expect(one("copie-dumps", sain, setup)).toEqual([
        { source: "copie-dumps", read: "illisible" },
      ]);
    },
    120_000,
  );

  it("more motifs than the reader takes are said as 1000, and the bulletin still reads", () => {
    const many = Array.from({ length: 1500 }, (_, i) => `motif=archive ${i} corrompue`).join("\n");
    const text = MALADE["myriade-base"].replace(/motif=.*\n/, `${many}\n`);
    const backups = one("myriade-base", text);
    expect(backups?.[0]?.read === "ok" && backups[0].motifs).toBe(1000);
  }, 120_000);
});

it("the backups are read without sudo (a test reads the script)", () => {
  const script = readFileSync(SCRIPT, "utf8");
  const section = script.slice(
    script.indexOf("# ── Version 3"),
    script.lastIndexOf("printf 'fin=1"),
  );
  expect(section.length).toBeGreaterThan(500);
  expect(section).not.toMatch(/\bsudo\s+-|\bsudo\s+\//);
  expect(section).not.toMatch(/\$\(.*sudo/);
});
