// Acting on the servers (J6f): a list of machines that refuses anything
// doubtful (root, an address that would be an ssh option, a shared key, a
// relative path, an action outside the catalogue); a switch that is off
// unless it says exactly `true`; ssh arguments that never carry a command;
// an exit code read as nothing more than it says.
import { describe, expect, it } from "vitest";
import {
  EXIT,
  motifPresent,
  outcomeOf,
  parseServerSwitch,
  parseServers,
  ServersConfigError,
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

  it.each([
    ["root", ok.replace('"cenacle"', '"root"')],
    ["an address that is an ssh option", ok.replace('"vps-b.exemple.test"', '"-oProxyCommand=x"')],
    ["an address with a user", ok.replace('"vps-b.exemple.test"', '"root@vps-b"')],
    ["an address with a port", ok.replace('"vps-b.exemple.test"', '"vps-b:2222"')],
    ["an address with a space", ok.replace('"vps-b.exemple.test"', '"vps-b x"')],
    ["a name in capitals", ok.replace('"vps-b"', '"VPS-B"')],
    [
      "a relative key",
      ok.replace('"/Users/exemple/.ssh/cenacle/vps-b-services"', '"vps-b-services"'),
    ],
    ["a key path climbing out", ok.replace("/cenacle/vps-b-services", "/../../etc/x")],
    ["an action outside the catalogue", ok.replace("services =", "reboot =")],
    ["a misspelt key", ok.replace("compte", "account")],
    ["another table", `${ok}[autre]\nx = 1\n`],
    ["a relative known_hosts", ok.replace(KH, 'known_hosts = "known_hosts"\n')],
    ["no known_hosts", ok.replace(KH, "")],
    ["not TOML", "[[serveur]\nnom ="],
  ])("refuses %s", (_label, text) => {
    expect(() => parseServers(text)).toThrow(ServersConfigError);
  });

  it("refuses the same machine twice", () => {
    expect(() => parseServers(`${ok}${ok.replace(KH, "")}`)).toThrow(/twice/);
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
