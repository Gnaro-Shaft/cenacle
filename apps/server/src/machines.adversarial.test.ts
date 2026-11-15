// The machines' bulletins (ADR-0039): one call per machine, its read-only key,
// the fingerprint pinned, never an action key; a machine that does not answer
// is unreachable, one that answers out of shape unreadable; one reading at a
// time, kept 30 s.
import { parseParkMachines } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { createMachines, type Run } from "./machines.ts";

const CONFIG = `
known_hosts = "/k/known_hosts"

[[machine]]
nom = "alpha"
adresse = "alpha.exemple.test"
compte = "cenacle"
cle = "/k/alpha-bulletin"

[[machine]]
nom = "beta"
adresse = "beta.exemple.test"
compte = "cenacle"
cle = "/k/beta-bulletin"
`;
const BULLETIN = [
  "bulletin=1",
  "version=1",
  "hote=alpha",
  "instant=1794679266",
  "processeurs=2",
  "fin=1",
].join("\n");

function setup(answers: Record<string, { code: number; out: string }>, over = {}) {
  const calls: string[][] = [];
  let now = 0;
  const run: Run = async (args) => {
    calls.push([...args]);
    const host = args.at(-1) ?? "";
    return answers[host] ?? { code: 255, out: "" };
  };
  const machines = createMachines({
    readConfig: () => CONFIG,
    run,
    keyOk: () => true,
    now: () => now,
    ...over,
  });
  return {
    machines,
    calls,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("reading the machines", () => {
  it("each machine in its own words; one that does not answer is unreachable, never healthy", async () => {
    const { machines } = setup({ "alpha.exemple.test": { code: 0, out: BULLETIN } });
    const view = await machines();
    expect(view.config).toBe("ok");
    expect(view.machines[0]).toMatchObject({ name: "alpha", read: "ok", bulletin: { cpus: 2 } });
    expect(view.machines[1]).toEqual({ name: "beta", read: "injoignable" });
  });

  it("a version 2 bulletin: the page is given its measures, nothing the ronde judges", async () => {
    const v2 = BULLETIN.replace("version=1", "version=2").replace(
      "\nfin=1",
      "\nredemarrage=requis\nmaj.total=4\nmaj.securite=1\nservices.a_relancer=2" +
        "\ngrappe.quorum=non\nports=tailnet/udp/41641,tcp/22\nfin=1",
    );
    const { machines } = setup({ "alpha.exemple.test": { code: 0, out: v2 } });
    const view = await machines();
    expect(view.machines[0]).toEqual({
      name: "alpha",
      read: "ok",
      bulletin: {
        host: "alpha",
        at: 1794679266000,
        uptimeSeconds: null,
        load: null,
        cpus: 2,
        memory: null,
        disks: [],
      },
    });
    const sent = JSON.stringify(view);
    for (const word of ["health", "version", "ports", "tailnet", "quorum", "reboot", "updates"]) {
      expect(sent).not.toContain(word);
    }
  });

  it.each([
    ["cut off by the time limit", { code: -1, out: "" }, "injoignable"],
    ["refused by the server (its forced command failed)", { code: 1, out: "" }, "illisible"],
    ["an answer out of shape", { code: 0, out: "hello" }, "illisible"],
    ["an answer cut short", { code: 0, out: BULLETIN.replace("\nfin=1", "") }, "illisible"],
  ])("%s: %s", async (_what, answer, read) => {
    const { machines } = setup({ "alpha.exemple.test": answer });
    expect((await machines()).machines[0]).toEqual({ name: "alpha", read });
  });

  it("the call: its own key, the pinned fingerprint, no command of ours — never an action key", async () => {
    const { machines, calls } = setup({});
    await machines();
    const args = calls[0] ?? [];
    expect(args).toContain("/k/alpha-bulletin");
    expect(args.join(" ")).toContain("StrictHostKeyChecking=yes");
    expect(args.join(" ")).toContain("UserKnownHostsFile=/k/known_hosts");
    // The address last, after "--": the server's forced command is the only one run.
    expect(args.slice(-2)).toEqual(["--", "alpha.exemple.test"]);
    expect(args.join(" ")).not.toMatch(/services|redemarrer|maj/);
  });

  it("a key readable by others is not used: said, no call made", async () => {
    const { machines, calls } = setup({}, { keyOk: (p: string) => p !== "/k/beta-bulletin" });
    const view = await machines();
    expect(view.machines[1]).toEqual({ name: "beta", read: "cle" });
    expect(calls.map((a) => a.at(-1))).toEqual(["alpha.exemple.test"]);
  });
});

describe("its file", () => {
  const unreadable = (): string | null => {
    throw new Error("EACCES");
  };
  const cases: readonly (readonly [string, () => string | null, "absent" | "illisible"])[] = [
    ["absent", () => null, "absent"],
    ["unreadable", unreadable, "illisible"],
    ["not TOML", () => "[[machine", "illisible"],
  ];
  it.each(cases)("%s: said, no machine read", async (_what, readConfig, config) => {
    const { machines, calls } = setup({}, { readConfig });
    expect(await machines()).toEqual({ config, machines: [] });
    expect(calls).toEqual([]);
  });

  it.each([
    ["an action key pasted in", `${CONFIG}cles = { services = "/k/x" }\n`],
    ["root", CONFIG.replace('compte = "cenacle"', 'compte = "root"')],
    ["a relative key path", CONFIG.replace('cle = "/k/alpha-bulletin"', 'cle = "k/alpha"')],
    ["a path that climbs", CONFIG.replace('cle = "/k/alpha-bulletin"', 'cle = "/k/../etc/a"')],
    [
      "an address that is an option",
      CONFIG.replace('adresse = "alpha.exemple.test"', 'adresse = "-oProxyCommand=x"'),
    ],
    ["the same key for two machines", CONFIG.replace("/k/beta-bulletin", "/k/alpha-bulletin")],
    ["the same name twice", CONFIG.replace('nom = "beta"', 'nom = "alpha"')],
  ])("the whole file is refused for %s", (_what, text) => {
    expect(() => parseParkMachines(text)).toThrow();
  });
});

describe("one reading at a time, kept 30 s", () => {
  it("the page asking three times at once: one call per machine, not three", async () => {
    const { machines, calls } = setup({});
    await Promise.all([machines(), machines(), machines()]);
    expect(calls).toHaveLength(2);
  });

  it("asked again within 30 s: no call; after: a new reading", async () => {
    const { machines, calls, tick } = setup({});
    await machines();
    tick(20_000);
    await machines();
    expect(calls).toHaveLength(2);
    tick(15_000);
    await machines();
    expect(calls).toHaveLength(4);
  });
});
