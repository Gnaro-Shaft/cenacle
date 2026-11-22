// What parc.local.toml says the ronde should expect of each machine
// (ADR-0040, R2): its host name, its ports — Legion's three jokers and no
// other — and its disk thresholds. Optional, so that today's file stays
// valid; anything out of shape refuses the whole file, as before.
import { describe, expect, it } from "vitest";
import { parseParkMachines } from "./park-machines.ts";

const machine = (extra: string) => `
known_hosts = "/k/known_hosts"

[[machine]]
nom = "alpha"
adresse = "alpha.exemple.test"
compte = "cenacle"
cle = "/k/alpha-bulletin"
${extra}
`;

describe("what the ronde expects", () => {
  it("nothing declared: no host name, no port, Legion's thresholds", () => {
    expect(parseParkMachines(machine("")).machines[0]?.expect).toEqual({
      hostname: null,
      ports: [],
      diskWarn: 80,
      diskAlert: 90,
      backups: [],
    });
  });

  it("everything declared", () => {
    const text = machine(`hote = "alpha-host.exemple"
ports = ["tcp/22", "local/tcp/25", "tailnet/udp/41641", "tailnet/tcp/*", "local/tcp/*"]
disque_avertir = 70
disque_alerter = 85
sauvegardes = ["copie-dumps", "veiller-sauvegardes"]`);
    expect(parseParkMachines(text).machines[0]?.expect).toEqual({
      hostname: "alpha-host.exemple",
      ports: ["tcp/22", "local/tcp/25", "tailnet/udp/41641", "tailnet/tcp/*", "local/tcp/*"],
      diskWarn: 70,
      diskAlert: 85,
      backups: ["copie-dumps", "veiller-sauvegardes"],
    });
  });

  it("the same threshold twice is allowed (Legion: avertir <= alerter)", () => {
    const text = machine("disque_avertir = 90\ndisque_alerter = 90");
    expect(parseParkMachines(text).machines[0]?.expect.diskWarn).toBe(90);
  });
});

describe("the whole file refused", () => {
  it.each([
    // Legion's refused jokers (tests/test_ronde_ports_adversarial.py).
    ["tcp/*", 'ports = ["tcp/*"]'],
    ["*", 'ports = ["*"]'],
    ["tailnet/*", 'ports = ["tailnet/*"]'],
    ["local/*", 'ports = ["local/*"]'],
    ["local/udp/*", 'ports = ["local/udp/*"]'],
    ["local/tcp/3*", 'ports = ["local/tcp/3*"]'],
    ["tailnet/tcp/**", 'ports = ["tailnet/tcp/**"]'],
    ["tailnet/tcp/6*", 'ports = ["tailnet/tcp/6*"]'],
    // And what a recited port can never be.
    ["an address", 'ports = ["100.64.1.2:22"]'],
    ["port zero", 'ports = ["tcp/0"]'],
    ["beyond 65535", 'ports = ["tcp/65536"]'],
    ["a leading zero", 'ports = ["tcp/022"]'],
    ["a scope of its own", 'ports = ["public/tcp/22"]'],
    ["a space", 'ports = [" tcp/22"]'],
    ["a port twice", 'ports = ["tcp/22", "tcp/22"]'],
    ["not a list", 'ports = "tcp/22"'],
    ["a number", "ports = [22]"],
    ["thresholds the wrong way round", "disque_avertir = 90\ndisque_alerter = 80"],
    ["a zero threshold", "disque_avertir = 0"],
    ["a threshold beyond 100", "disque_alerter = 101"],
    ["a threshold with a decimal", "disque_alerter = 85.5"],
    ["a threshold as text", 'disque_alerter = "85"'],
    ["a host name with a space", 'hote = "alpha host"'],
    ["a host name as an option", 'hote = "-oProxyCommand=x"'],
    ["an empty host name", 'hote = ""'],
    ["a key of Legion's own", 'utilisateur = "cenacle"'],
  ])("%s", (_what, extra) => {
    expect(() => parseParkMachines(machine(extra))).toThrow();
  });

  it("a refused port is not echoed in the error (it could be anything)", () => {
    expect(() => parseParkMachines(machine('ports = ["secret-thing"]'))).toThrow(
      /^(?!.*secret-thing)/,
    );
  });
});
