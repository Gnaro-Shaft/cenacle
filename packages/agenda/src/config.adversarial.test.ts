// The agenda's accounts (ADR-0042, point 5): an account not declared is not
// read; https only; admitted hosts named exactly, never a joker; two
// declarations of one account under two names refused; a wrong file said with
// the field at fault, never a value; the password from .env.agenda.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgendaConfig, parseAgendaConfig } from "./config.ts";

const ENV = {
  CENACLE_AGENDA_MOT_DE_PASSE_PRO: "pw-pro-value",
  CENACLE_AGENDA_MOT_DE_PASSE_PERSO: "pw-perso-value",
};
const account = (fields: string) => `[[compte]]\n${fields}\n`;
const PRO = account(
  'nom = "pro"\nserveur = "https://dav.exemple.test/cal/"\nidentifiant = "moi@exemple.test"',
);
const PERSO = account(
  [
    'nom = "perso"',
    'serveur = "https://caldav.exemple.test/"',
    'identifiant = "moi.perso@exemple.test"',
    'hotes = ["p01-caldav.exemple.test"]',
    'exclus = ["Rappels de Legion", " Anniversaires "]',
  ].join("\n"),
);

const why = (text: string) => {
  const config = parseAgendaConfig(text, ENV);
  expect(config.read).toBe("config");
  return config.read === "config" ? config.why : "";
};

describe("what is read", () => {
  it("no file: nothing to read, said apart from a wrong file", () => {
    expect(parseAgendaConfig(null, ENV)).toEqual({ read: "absent" });
    const dir = mkdtempSync(join(tmpdir(), "agenda-config-"));
    expect(loadAgendaConfig(join(dir, "absent.toml"), ENV)).toEqual({ read: "absent" });
    writeFileSync(join(dir, "agenda.local.toml"), PRO);
    expect(loadAgendaConfig(join(dir, "agenda.local.toml"), ENV).read).toBe("ok");
    rmSync(dir, { recursive: true, force: true });
  });

  it("two accounts: their hosts, exclusions, and passwords by name", () => {
    const config = parseAgendaConfig(PRO + PERSO, ENV);
    if (config.read !== "ok") throw new Error(config.read);
    const [pro, perso] = config.accounts;
    expect(pro?.password).toBe("pw-pro-value");
    expect([...(pro?.admitted ?? [])]).toEqual(["dav.exemple.test"]);
    expect([...(perso?.admitted ?? [])]).toEqual([
      "caldav.exemple.test",
      "p01-caldav.exemple.test",
    ]);
    expect([...(perso?.excluded ?? [])]).toEqual(["Rappels de Legion", "Anniversaires"]);
  });

  it("an account without its password is read as such: said, not guessed", () => {
    const config = parseAgendaConfig(PRO, {});
    expect(config.read === "ok" && config.accounts[0]?.password).toBeNull();
  });

  it("a server on another port admits that port only", () => {
    const config = parseAgendaConfig(
      account('nom = "a"\nserveur = "https://dav.exemple.test:8443/"\nidentifiant = "x"'),
      ENV,
    );
    expect(config.read === "ok" && [...(config.accounts[0]?.admitted ?? [])]).toEqual([
      "dav.exemple.test:8443",
    ]);
  });
});

describe("what is refused, said by its field, never its value", () => {
  it.each([
    ["plain HTTP", 'serveur = "http://dav.exemple.test/"', /https/],
    ["a login in the address", 'serveur = "https://moi:pw-in-url@dav.exemple.test/"', /https/],
    ["a query", 'serveur = "https://dav.exemple.test/?x=1"', /https/],
    ["not an address", 'serveur = "dav.exemple.test"', /serveur/],
  ])("%s", (_, line, rule) => {
    const message = why(account(`nom = "pro"\n${line}\nidentifiant = "moi@exemple.test"`));
    expect(message).toMatch(rule);
    expect(message).not.toContain("pw-in-url");
    expect(message).not.toContain("moi@exemple.test");
  });

  it.each([
    ["a joker", '"*.exemple.test"'],
    ["a leading dot", '".exemple.test"'],
    ["capitals", '"Dav.Exemple.test"'],
    ["a port", '"dav.exemple.test:443"'],
    ["an address", '"https://dav.exemple.test"'],
  ])("an admitted host with %s", (_, host) => {
    expect(why(`${PRO.trimEnd()}\nhotes = [${host}]\n`)).toMatch(/hotes/);
  });

  it("an unknown key, in the account or above: refused, named", () => {
    expect(why(`${PRO.trimEnd()}\nmot_de_passe = "pw-secret"\n`)).toMatch(/mot_de_passe/);
    expect(why(`${PRO.trimEnd()}\nmot_de_passe = "pw-secret"\n`)).not.toContain("pw-secret");
    expect(why(`fenetre = 3\n${PRO}`)).toMatch(/fenetre/);
  });

  it("names: the rule, and twice the same refused", () => {
    expect(why(account('nom = "Pro!"\nserveur = "https://a.test/"\nidentifiant = "x"'))).toMatch(
      /nom/,
    );
    expect(why(PRO + PRO.replace("moi@", "autre@"))).toMatch(/deux comptes nommés/);
  });

  it("the same account under two names (same host, same login, any case): refused", () => {
    const twin = PRO.replace('"pro"', '"pro2"').replace("/cal/", "/autre/").replace("moi@", "MOI@");
    expect(why(PRO + twin)).toMatch(/même compte/);
  });

  it("a login with a colon (it would split the password), or empty: refused", () => {
    expect(why(account('nom = "a"\nserveur = "https://a.test/"\nidentifiant = "x:y"'))).toMatch(
      /identifiant/,
    );
    expect(why(account('nom = "a"\nserveur = "https://a.test/"\nidentifiant = ""'))).toMatch(
      /identifiant/,
    );
  });

  it("not TOML, too many accounts", () => {
    expect(why("[[compte]\n")).toMatch(/TOML/);
    const many = Array.from({ length: 9 }, (_, i) =>
      account(`nom = "c${i}"\nserveur = "https://h${i}.test/"\nidentifiant = "x"`),
    ).join("");
    expect(why(many)).toMatch(/au plus/);
  });
});
