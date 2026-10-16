// The CERT-FR's feeds at the round (J6e3), with a stand-in fetch: read
// through the veille's reader, on the CERT-FR's new host; a feed down, empty,
// turned into a web page, or whose links no longer have the CERT-FR's form
// proves nothing (could not run — never a silent "nothing found"); an unreadable list of my software stops
// both checks; the versioned list is valid as it stands.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bulletinResults, loadSoftware } from "./bulletins-check.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-bulletins-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const NOW = Date.parse("2026-10-11T10:00:00Z");
const ROOT = join(import.meta.dirname, "..", "..", "..");

const rss = (items: string) =>
  `<?xml version="1.0"?><rss><channel><title>CERT-FR</title>${items}</channel></rss>`;
const entry = (kind: string, id: string, title: string, date = "Fri, 09 Oct 2026 00:00:00 +0000") =>
  `<item><title>${title}</title><link>https://www.cert.ssi.gouv.fr/${kind}/${id}/</link><pubDate>${date}</pubDate><description>x</description></item>`;

function fetchFrom(pages: { alerte: string | number; avis: string | number }): typeof fetch {
  return (async (url: string | URL) => {
    const page = String(url).includes("/alerte/") ? pages.alerte : pages.avis;
    if (typeof page === "number") return new Response("nope", { status: page });
    return new Response(page, { status: 200 });
  }) as typeof fetch;
}

const linked = (kind: string, id: string, link: string) =>
  `<item><title>Vulnérabilité dans Ubuntu</title><link>${link}</link><pubDate>Fri, 09 Oct 2026 00:00:00 +0000</pubDate><description>x</description></item>`;

describe("the CERT-FR's form of links", () => {
  it("both feeds are read on the new host", async () => {
    const asked: string[] = [];
    await bulletinResults(["Ubuntu"], {
      fetch: (async (url: string | URL) => {
        asked.push(String(url));
        return new Response(rss(""), { status: 200 });
      }) as typeof fetch,
      now: () => NOW,
    });
    expect(asked.sort()).toEqual([
      "https://cert.cyber.gouv.fr/alerte/feed/",
      "https://cert.cyber.gouv.fr/avis/feed/",
    ]);
  });

  it("items, but no link in the CERT-FR's form: could not run, not 'nothing found'", async () => {
    const odd = rss(
      linked(
        "avis",
        "CERTFR-2026-AVI-1",
        "https://cert.gouv.example.test/avis/CERTFR-2026-AVI-1/",
      ) + linked("avis", "CERTFR-2026-AVI-2", "https://cert.cyber.gouv.fr/bulletin/2026-2/"),
    );
    const results = await bulletinResults(["Ubuntu"], {
      fetch: fetchFrom({ alerte: odd, avis: odd }),
      now: () => NOW,
    });
    expect(results.map((r) => [r.check, r.ran])).toEqual([
      ["certfr_alertes", false],
      ["certfr_avis", false],
    ]);
  });

  it("one link in the form among odd ones: it runs, and keeps that one", async () => {
    const mixed = rss(
      linked(
        "avis",
        "CERTFR-2026-AVI-1",
        "https://cert.gouv.example.test/avis/CERTFR-2026-AVI-1/",
      ) + linked("avis", "CERTFR-2026-AVI-9", "https://cert.cyber.gouv.fr/avis/CERTFR-2026-AVI-9/"),
    );
    const results = await bulletinResults(["Ubuntu"], {
      fetch: fetchFrom({
        alerte: rss(entry("alerte", "CERTFR-2026-ALE-1", "Windows")),
        avis: mixed,
      }),
      now: () => NOW,
    });
    expect(results.map((r) => [r.check, r.ran && r.observations.map((o) => o.target)])).toEqual([
      ["certfr_alertes", []],
      ["certfr_avis", ["CERTFR-2026-AVI-9"]],
    ]);
  });
});

describe("the feeds", () => {
  it("read both; what names my software becomes a finding of its own check", async () => {
    const results = await bulletinResults(["Ubuntu", "Node.js"], {
      fetch: fetchFrom({
        alerte: rss(entry("alerte", "CERTFR-2026-ALE-010", "Vulnérabilité dans Node.js")),
        avis: rss(
          entry("avis", "CERTFR-2026-AVI-1252", "Vulnérabilité dans le noyau Linux d&#039;Ubuntu") +
            entry("avis", "CERTFR-2026-AVI-1253", "Vulnérabilité dans Windows"),
        ),
      }),
      now: () => NOW,
    });
    expect(results.map((r) => [r.check, r.ran && r.observations.map((o) => o.target)])).toEqual([
      ["certfr_alertes", ["CERTFR-2026-ALE-010"]],
      ["certfr_avis", ["CERTFR-2026-AVI-1252"]],
    ]);
  });

  it.each([
    ["a feed down", 503],
    ["an empty feed", rss("")],
    ["a web page instead of a feed", "<html><body>Maintenance</body></html>"],
  ])("%s: could not run, and closes nothing", async (_label, page) => {
    const results = await bulletinResults(["Ubuntu"], {
      fetch: fetchFrom({ alerte: page, avis: rss(entry("avis", "CERTFR-2026-AVI-1", "Ubuntu")) }),
      now: () => NOW,
    });
    expect(results.map((r) => [r.check, r.ran])).toEqual([
      ["certfr_alertes", false],
      ["certfr_avis", true],
    ]);
  });

  it("no list of my software: neither check runs", async () => {
    let called = 0;
    const results = await bulletinResults(null, {
      fetch: (async () => {
        called += 1;
        return new Response("");
      }) as typeof fetch,
      now: () => NOW,
    });
    expect(results.map((r) => r.ran)).toEqual([false, false]);
    expect(called).toBe(0);
  });
});

describe("the list of my software", () => {
  it("the versioned securite.toml is valid as it stands", () => {
    expect(loadSoftware(ROOT)).toEqual(expect.arrayContaining(["Ubuntu", "Node.js", "macOS"]));
  });

  it("both files merged, each name once; one unreadable file: no list", () => {
    const root = join(BASE, "racine");
    mkdirSync(root);
    writeFileSync(join(root, "securite.toml"), '[bulletins]\nlogiciels = ["Ubuntu"]\n');
    writeFileSync(
      join(root, "securite.local.toml"),
      '[bulletins]\nlogiciels = ["Ubuntu", "Grafana"]\n',
    );
    expect(loadSoftware(root)).toEqual(["Ubuntu", "Grafana"]);
    writeFileSync(join(root, "securite.local.toml"), '[bulletins]\nlogiciels = [".*"]\n');
    expect(loadSoftware(root)).toBeNull();
  });
});
