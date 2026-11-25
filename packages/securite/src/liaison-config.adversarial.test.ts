// The liaison's configuration (ADR-0048): the door is a name, never an
// address; paths are absolute, without whitespace (ssh splits on it) nor `..`;
// folders are a closed list; an unknown key or section is refused; an error
// says its kind, never a value. The switch is on only on `actif = true`, and
// an unreadable switch is said as such, never taken for "off".
import { describe, expect, it } from "vitest";
import {
  LiaisonConfigError,
  parseLiaisonDossiers,
  parseLiaisonPorte,
  parseLiaisonSwitch,
} from "./liaison-config.ts";

const ok: Record<string, string> = {
  hote: '"vm-maison"',
  compte: '"liaison"',
  cle: '"/Users/moi/.ssh/cenacle-liaison"',
  known_hosts: '"/Users/moi/.ssh/cenacle-liaison.known_hosts"',
  dossiers: '["maison-etalon"]',
};
const toml = (over: Record<string, string | null> = {}) =>
  `[liaison]\n${Object.entries({ ...ok, ...over })
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n")}\n`;
const kind = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(LiaisonConfigError);
    return (e as LiaisonConfigError).problem;
  }
};

describe("the door", () => {
  it("read as written", () => {
    expect(parseLiaisonPorte(toml())).toEqual({
      hote: "vm-maison",
      compte: "liaison",
      cle: "/Users/moi/.ssh/cenacle-liaison",
      knownHosts: "/Users/moi/.ssh/cenacle-liaison.known_hosts",
    });
    expect(parseLiaisonPorte(toml({ hote: '"vm.tailnet-exemple.ts.net"' })).hote).toBe(
      "vm.tailnet-exemple.ts.net",
    );
  });

  const refus: [string, Record<string, string | null>, string][] = [
    ["an address", { hote: '"100.64.0.1"' }, "hote"],
    ["an option for ssh", { hote: '"-oProxyCommand=x"' }, "hote"],
    ["a user in the host", { hote: '"root@vm"' }, "hote"],
    ["uppercase account", { compte: '"Liaison"' }, "compte"],
    ["a relative key", { cle: '"cle"' }, "cle"],
    ["a key path with a space", { cle: '"/Users/moi/Application Support/cle"' }, "cle"],
    ["a key path with ..", { cle: '"/Users/moi/../root/cle"' }, "cle"],
    ["known_hosts missing", { known_hosts: null }, "known_hosts"],
    ["an unknown key", { port: "22" }, "cle_inconnue"],
  ];
  for (const [what, over, problem] of refus) {
    it(`${what}: refused (${problem})`, () => {
      expect(kind(() => parseLiaisonPorte(toml(over)))).toBe(problem);
    });
  }

  it("another section, or none, or not TOML: refused, never a value quoted", () => {
    expect(kind(() => parseLiaisonPorte(`${toml()}[autre]\nx = 1\n`))).toBe("racine");
    expect(kind(() => parseLiaisonPorte("hote = 'x'\n"))).toBe("racine");
    expect(kind(() => parseLiaisonPorte("[liaison\n"))).toBe("toml");
    expect(() => parseLiaisonPorte(toml({ hote: '"100.64.0.1"' }))).toThrow(/^(?!.*100\.64)/s);
  });
});

describe("the folders", () => {
  it("1 to 20 names, no duplicate", () => {
    expect(parseLiaisonDossiers(toml({ dossiers: '["a", "b-2"]' }))).toEqual(["a", "b-2"]);
    for (const d of ["[]", '["a", "a"]', '["../x"]', '["A"]', "[1]", '"a"']) {
      expect(kind(() => parseLiaisonDossiers(toml({ dossiers: d })))).toBe("dossiers");
    }
  });
});

describe("the switch", () => {
  const cas: [string | null, string][] = [
    ["[liaison]\nactif = true\n", "actif"],
    ["[liaison]\nactif = false\n", "coupe"],
    [null, "illisible"],
    ["", "illisible"],
    ['[liaison]\nactif = "true"\n', "illisible"],
    ["[liaison]\nactif = 1\n", "illisible"],
    ["[liaison]\nactif = true\nautre = 1\n", "illisible"],
    ["[liaison]\nactif = true\n[x]\n", "illisible"],
    ["[liaison\n", "illisible"],
  ];
  for (const [text, expected] of cas) {
    it(`${JSON.stringify(text)}: ${expected}`, () => {
      expect(parseLiaisonSwitch(text)).toBe(expected);
    });
  }
});
