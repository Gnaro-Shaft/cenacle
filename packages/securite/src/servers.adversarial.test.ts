// Acting on the servers (J6f): a list of machines that refuses anything
// doubtful (root, an address that would be an ssh option, a shared key, a
// relative path, an action outside the catalogue); a switch that is off
// unless it says exactly `true`; ssh arguments that never carry a command;
// an exit code read as nothing more than it says — the spared count of
// cenacle-services included, and only for it (ADR-0035, point 7).
import { describe, expect, it } from "vitest";
import {
  answerOf,
  EXIT,
  hostState,
  motifPresent,
  outcomeOf,
  parseServerSwitch,
  parseServers,
  SERVERS_CONFIG_PROBLEMS,
  ServersConfigError,
  serverActionFor,
  sshArgs,
  verdictInstant,
} from "./servers.ts";

const KH = 'known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"\n';
const ok = `${KH}[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }
`;

describe("my machines", () => {
  it("reads a plain list", () => {
    expect(parseServers(ok)).toEqual({
      knownHosts: "/Users/exemple/.ssh/cenacle/known_hosts",
      servers: [
        {
          name: "vps-b",
          address: "vps-b.exemple.test",
          account: "cenacle",
          keys: { services: "/Users/exemple/.ssh/cenacle/vps-b-services" },
        },
      ],
    });
  });

  const block = ok.replace(KH, "");
  it.each([
    ["root", ok.replace('"cenacle"', '"root"'), "compte"],
    [
      "an address that is an ssh option",
      ok.replace('"vps-b.exemple.test"', '"-oProxyCommand=x"'),
      "adresse",
    ],
    ["an address with a user", ok.replace('"vps-b.exemple.test"', '"root@vps-b"'), "adresse"],
    ["an address with a port", ok.replace('"vps-b.exemple.test"', '"vps-b:2222"'), "adresse"],
    ["an address with a space", ok.replace('"vps-b.exemple.test"', '"vps-b x"'), "adresse"],
    ["a name in capitals", ok.replace('"vps-b"', '"VPS-B"'), "nom"],
    [
      "a relative key",
      ok.replace('"/Users/exemple/.ssh/cenacle/vps-b-services"', '"vps-b-services"'),
      "chemin",
    ],
    ["a key path climbing out", ok.replace("/cenacle/vps-b-services", "/../../etc/x"), "chemin"],
    ["an action outside the catalogue", ok.replace("services =", "reboot ="), "action"],
    ["a misspelt key", ok.replace("compte", "account"), "cle_inconnue"],
    // 2026-10-12: Legion's port list pasted into a block refused every action for two days.
    [
      "Legion's ports in a block",
      ok.replace("cles =", 'ports = ["tcp/22"]\ncles ='),
      "cle_inconnue",
    ],
    ["a machine without cles", ok.replace(/cles = .*\n/, ""), "cles"],
    [
      "one key for two actions",
      ok.replace(
        'cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }',
        'cles = { services = "/Users/exemple/.ssh/k", redemarrer = "/Users/exemple/.ssh/k" }',
      ),
      "partagee",
    ],
    ["another table", `${ok}[autre]\nx = 1\n`, "racine"],
    ["serveur as a plain value", `${KH}serveur = "vps-b"\n`, "bloc"],
    ["a block that is not a table", `${KH}serveur = [1]\n`, "bloc"],
    [
      "21 machines",
      KH + Array.from({ length: 21 }, (_, i) => block.replace(/vps-b/g, `vps-${i}`)).join(""),
      "trop",
    ],
    ["a relative known_hosts", ok.replace(KH, 'known_hosts = "known_hosts"\n'), "chemin"],
    ["no known_hosts", ok.replace(KH, ""), "chemin"],
    ["not TOML", "[[serveur]\nnom =", "toml"],
  ])("refuses %s, and says which kind (%s)", (_label, text, problem) => {
    let thrown: unknown;
    try {
      parseServers(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ServersConfigError);
    expect((thrown as ServersConfigError).problem).toBe(problem);
  });

  it("names no kind outside the closed list", () => {
    expect(SERVERS_CONFIG_PROBLEMS).toContain("cle_inconnue");
    for (const p of SERVERS_CONFIG_PROBLEMS) expect(p).toMatch(/^[a-z_]{1,33}$/);
  });

  it("refuses the same machine twice", () => {
    expect(() => parseServers(`${ok}${block}`)).toThrow(/twice/);
  });
});

describe("the general switch", () => {
  it.each([
    ["[serveurs]\nactif = true\n", true],
    ["[serveurs]\nactif = false\n", false],
    ['[serveurs]\nactif = "true"\n', false],
    ["[serveurs]\nactif = 1\n", false],
    ["", false],
    ["not toml [", false],
  ])("%j → %s", (text, expected) => {
    expect(parseServerSwitch(text)).toBe(expected);
  });
});

describe("the ssh call", () => {
  const { servers, knownHosts } = parseServers(ok);
  const server = servers[0];
  if (server === undefined) throw new Error("no server");
  const args = sshArgs(server, "/Users/exemple/.ssh/cenacle/vps-b-services", knownHosts);

  it("fixed options, the host after --, and nothing after it: the server imposes the command", () => {
    expect(args.slice(-2)).toEqual(["--", "vps-b.exemple.test"]);
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("IdentitiesOnly=yes");
    expect(args).toEqual(expect.arrayContaining(["-F", "/dev/null", "-T", "-l", "cenacle"]));
  });

  it("an exit code means what the script says, and nothing else is done", () => {
    expect([0, 10, 11, 12, 255, -1, 1].map(outcomeOf)).toEqual([
      "faite",
      "rien_a_faire",
      "refusee_serveur",
      "echouee",
      "echouee",
      "echouee",
      "echouee",
    ]);
    expect(EXIT.done).toBe(0);
  });

  it("services: 20 + n and 120 + n carry what was spared, n from 1 to 99, and only them", () => {
    const read = (code: number) => answerOf("services", code);
    expect(read(21)).toEqual({ outcome: "faite", spared: 1 });
    expect(read(119)).toEqual({ outcome: "faite", spared: 99 });
    expect(read(121)).toEqual({ outcome: "rien_a_faire", spared: 1 });
    expect(read(219)).toEqual({ outcome: "rien_a_faire", spared: 99 });
    expect(read(0)).toEqual({ outcome: "faite", spared: null });
    expect(read(10)).toEqual({ outcome: "rien_a_faire", spared: null });
    // The bases themselves, beyond the ranges, and what is not an integer: a failure.
    for (const code of [20, 120, 220, 254, 255, -1, 1, 13, 21.5, Number.NaN]) {
      expect(read(code)).toEqual({ outcome: "echouee", spared: null });
    }
    expect(read(11)).toEqual({ outcome: "refusee_serveur", spared: null });
  });

  it("another action's 21 or 121 stays a failure: only cenacle-services counts", () => {
    for (const action of ["redemarrer", "maj_securite"] as const) {
      expect(answerOf(action, 21)).toEqual({ outcome: "echouee", spared: null });
      expect(answerOf(action, 121)).toEqual({ outcome: "echouee", spared: null });
    }
  });
});

describe("Legion's verdict", () => {
  it("its instant, in milliseconds; none, or malformed: null", () => {
    expect(verdictInstant("bulletin=1\ninstant=1760000000\nfin=1")).toBe(1_760_000_000_000);
    expect(verdictInstant("instant=abc")).toBeNull();
    expect(verdictInstant("xinstant=1760000000")).toBeNull();
  });

  it("the problem is still there only for that machine and that kind", () => {
    const seen = [
      {
        type: "serveur_services",
        target: "vps-b",
        occurrence: "-",
        severity: "moyen" as const,
        title: "x",
      },
    ];
    expect(motifPresent(seen, "vps-b", "serveur_services")).toBe(true);
    expect(motifPresent(seen, "vps-c", "serveur_services")).toBe(false);
    expect(motifPresent(seen, "vps-b", "serveur_redemarrage")).toBe(false);
  });
});

describe("a reboot in the catalogue (J6f2)", () => {
  it("each kind of finding has at most one action", () => {
    expect(serverActionFor("serveur_services")).toBe("services");
    expect(serverActionFor("serveur_redemarrage")).toBe("redemarrer");
    expect(serverActionFor("serveur_maj_securite")).toBe("maj_securite");
    expect(serverActionFor("serveur_disque")).toBeNull();
  });

  it("a machine's state in the verdict: exactly its own line, never a lookalike", () => {
    const raw = "bulletin=1\nv10.etat=MALADE\nv100.etat=SAIN\nnoeud-a.etat=SOUFFRANT\nfin=1";
    expect(hostState(raw, "v10")).toBe("MALADE");
    expect(hostState(raw, "v100")).toBe("SAIN");
    expect(hostState(raw, "noeud-a")).toBe("SOUFFRANT");
    expect(hostState(raw, "noeud")).toBeNull();
    expect(hostState(raw, "10")).toBeNull();
    expect(hostState(raw, "a")).toBeNull();
    expect(hostState(raw, "v1.")).toBeNull();
    expect(hostState(raw, ".*")).toBeNull();
    expect(hostState("v10.etat=PERDU", "v10")).toBeNull();
  });

  it("a reboot key and a services key, never the same file", () => {
    expect(() =>
      parseServers(
        ok.replace(
          'cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }',
          'cles = { services = "/k", redemarrer = "/k" }',
        ),
      ),
    ).toThrow(/never shared/);
    expect(
      parseServers(
        ok.replace(
          'cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }',
          'cles = { redemarrer = "/k2" }',
        ),
      ).servers[0]?.keys,
    ).toEqual({ redemarrer: "/k2" });
  });
});
