// The leak measure sets aside a sender domain only where it is public and
// appears in links to itself, nowhere else: declared in the versioned
// configuration, written as a link's host. Anything else stays a leak.
import { describe, expect, it } from "vitest";
import { findLeaks, type Needle } from "./measure.ts";
import { declaredHosts, isPublicDomain, withoutLinksTo } from "./public-domains.ts";

const CONFIG = `
[[sources]]
nom = "Forge"
url = "https://forge.example/projet/releases.atom"
[[sources]]
url = "https://blog.editeur.example/feed"
note = "pas un lien : sans-schema.example"
`;
const hosts = declaredHosts([CONFIG]);
const needles: Needle[] = [{ kind: "domaine", value: "forge.example" }];
const find = (text: string, h: ReadonlySet<string> = hosts) =>
  findLeaks(needles, [{ where: "veille_articles", text }], h);

describe("declaredHosts and isPublicDomain", () => {
  it("only the hosts of http(s) URLs", () => {
    expect([...hosts].sort()).toEqual(["blog.editeur.example", "forge.example"]);
  });

  it.each([
    ["the host itself", "forge.example", true],
    ["any case, a trailing dot", "FORGE.Example.", true],
    ["the parent of a declared host", "editeur.example", true],
    ["a subdomain of a declared host", "mail.forge.example", false],
    ["written without a scheme", "sans-schema.example", false],
    ["a host that only ends like it", "orge.example", false],
    ["a bare top-level name", "example", false],
  ])("%s: %s → %s", (_label, domain, expected) => {
    expect(isPublicDomain(domain, hosts)).toBe(expected);
  });
});

describe("findLeaks with public hosts", () => {
  it("links to it only: counted apart, never as a leak", () => {
    expect(find('{"lien": "https://forge.example/projet/releases/tag/v2", "titre": "v2"}')).toEqual(
      [{ kind: "domaine", where: "veille_articles", publicLink: true }],
    );
  });

  it.each([
    ["a subdomain, a port, a query", "https://api.forge.example:8443/v1?x=1#a"],
    ["JSON-escaped slashes", "https:\\/\\/forge.example\\/projet"],
    ["upper case", "HTTPS://FORGE.EXAMPLE/Projet"],
    ["a row in PostgreSQL's record text", '(12,"{""url"": ""https://forge.example/a""}")'],
  ])("still a link: %s", (_label, text) => {
    expect(find(text)).toEqual([{ kind: "domaine", where: "veille_articles", publicLink: true }]);
  });

  it.each([
    ["an address at it", "écrit par contact@forge.example"],
    ["free text", "un message de forge.example ce matin"],
    ["a link, and free text too", "https://forge.example/a — et forge.example ailleurs"],
    ["a host that only starts like it", "https://forge.example.evil.example/a"],
    ["written as a link's user", "https://forge.example@evil.example/a"],
    ["split across two words", "la forge, example de ce matin"],
  ])("still a leak: %s", (_label, text) => {
    expect(find(text)).toEqual([{ kind: "domaine", where: "veille_articles" }]);
  });

  it("an undeclared domain in a link is still a leak", () => {
    expect(find("https://forge.example/a", new Set())).toEqual([
      { kind: "domaine", where: "veille_articles" },
    ]);
  });

  it("a real leak wins over a public link in the same table, in any order", () => {
    const rows = ["https://forge.example/a", "contact@forge.example"];
    for (const order of [rows, [...rows].reverse()]) {
      expect(
        findLeaks(
          needles,
          order.map((text) => ({ where: "veille_articles", text })),
          hosts,
        ),
      ).toEqual([{ kind: "domaine", where: "veille_articles" }]);
    }
  });

  it("only domains are ever set aside: an address in a link stays a leak", () => {
    expect(
      findLeaks(
        [{ kind: "adresse", value: "equipe@forge.example" }],
        [{ where: "veille_articles", text: "https://forge.example/u/equipe@forge.example" }],
        hosts,
      ),
    ).toEqual([{ kind: "adresse", where: "veille_articles" }]);
  });

  it("a hit never carries the value it found", () => {
    expect(JSON.stringify(find("https://forge.example/a"))).not.toMatch(/forge/i);
  });
});

describe("withoutLinksTo", () => {
  it("removes the whole link, path included, and nothing else", () => {
    expect(
      withoutLinksTo("voir https://forge.example/a/b?c=1 puis la suite", "forge.example"),
    ).toBe("voir   puis la suite");
  });

  it("a domain full of regular-expression characters is taken literally", () => {
    expect(withoutLinksTo("https://forgeXexample/a", "forge.example")).toBe(
      "https://forgeXexample/a",
    );
  });

  it("a long text is read in linear time", () => {
    const text = "https://forge.example/a ".repeat(50_000);
    const started = Date.now();
    expect(withoutLinksTo(text, "forge.example").trim()).toBe("");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
