// One pass of the ronde (ADR-0040, R2): each machine read with its own
// read-only key, the fingerprint pinned, never an action key; each judged on
// its own — a machine that fails is MALADE with its reason, never SAIN, and
// never holds the others back; the page is given measures only.
import { describe, expect, it } from "vitest";
import { type PassDeps, runPass } from "./pass.ts";
import type { Run } from "./ssh.ts";

const CONFIG = `
known_hosts = "/k/known_hosts"

[[machine]]
nom = "alpha"
adresse = "alpha.exemple.test"
compte = "cenacle"
cle = "/k/alpha-bulletin"
hote = "alpha-host"
ports = ["tcp/22"]

[[machine]]
nom = "beta"
adresse = "beta.exemple.test"
compte = "cenacle"
cle = "/k/beta-bulletin"
hote = "beta-host"
ports = ["tcp/22"]
`;
const NOW = 1_794_679_300_000;
const bulletin = (host: string, extra = "") =>
  [
    "bulletin=1",
    "version=2",
    `hote=${host}`,
    "instant=1794679266",
    "processeurs=2",
    "disque.1.montage=/",
    "disque.1.pourcent=41",
    "disque.1.kilooctets=1000",
    "redemarrage=non",
    "maj.total=0",
    "maj.securite=0",
    "services.a_relancer=0",
    `ports=tcp/22${extra}`,
    "fin=1",
  ].join("\n");

type Answer = { code: number; out: string };

function setup(answers: Record<string, Answer>, over: Partial<PassDeps> = {}) {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push([...args]);
    return answers[args.at(-1) ?? ""] ?? { code: 255, out: "" };
  };
  const pass = () =>
    runPass({ readConfig: () => CONFIG, run, keyOk: () => true, now: () => NOW, ...over });
  return { pass, calls };
}

const healthy: Record<string, Answer> = {
  "alpha.exemple.test": { code: 0, out: bulletin("alpha-host") },
  "beta.exemple.test": { code: 0, out: bulletin("beta-host") },
};

describe("a pass", () => {
  it("every machine healthy: SAIN, in the file's order, measures for the page", async () => {
    const r = await setup(healthy).pass();
    expect(r.hosts).toEqual([
      { name: "alpha", state: "SAIN", motifs: [] },
      { name: "beta", state: "SAIN", motifs: [] },
    ]);
    expect(r.bulletins.config).toBe("ok");
    expect(r.bulletins.machines[0]).toMatchObject({ name: "alpha", read: "ok" });
    expect(r.notes).toEqual([]);
  });

  it("judged: an unexpected port is MALADE in Legion's words", async () => {
    const answers = {
      ...healthy,
      "alpha.exemple.test": { code: 0, out: bulletin("alpha-host", ",tcp/4444") },
    };
    expect((await setup(answers).pass()).hosts[0]).toEqual({
      name: "alpha",
      state: "MALADE",
      motifs: ["port(s) inattendu(s) : tcp/4444"],
    });
  });

  it("the page's file never carries what the ronde judges", async () => {
    const sent = JSON.stringify((await setup(healthy).pass()).bulletins);
    for (const word of ["health", "version", "ports", "quorum", "reboot", "updates"]) {
      expect(sent).not.toContain(word);
    }
  });
});

describe("a machine that cannot be judged: MALADE with its reason, the others judged", () => {
  const cut = bulletin("alpha-host").replace("\nfin=1", "");
  const twice = bulletin("alpha-host").replace("fin=1", "maj.total=3\nfin=1");
  it.each([
    ["no answer (ssh 255)", 255, "", "injoignable", "alpha : injoignable (ssh a rendu 255)"],
    ["cut off by the time limit", -1, "", "injoignable", "alpha : injoignable (delai depasse)"],
    ["refused by the server", 1, "", "illisible", "alpha : ssh a rendu 1"],
    ["an answer out of shape", 0, "hello", "illisible", "alpha : bulletin illisible"],
    ["an answer cut short", 0, cut, "illisible", "alpha : bulletin illisible"],
    ["a key twice", 0, twice, "illisible", "alpha : bulletin illisible"],
  ])("%s", async (_what, code, out, read, motif) => {
    const r = await setup({ ...healthy, "alpha.exemple.test": { code, out } }).pass();
    expect(r.hosts[0]).toEqual({ name: "alpha", state: "MALADE", motifs: [motif] });
    expect(r.bulletins.machines[0]).toEqual({ name: "alpha", read });
    expect(r.hosts[1]).toEqual({ name: "beta", state: "SAIN", motifs: [] });
  });

  it("another machine's bulletin: MALADE, none of its measures shown as this one's", async () => {
    const answers = { ...healthy, "alpha.exemple.test": { code: 0, out: bulletin("beta-host") } };
    const r = await setup(answers).pass();
    expect(r.hosts[0]).toEqual({
      name: "alpha",
      state: "MALADE",
      motifs: ["bulletin d'un autre hote (beta-host) — non juge"],
    });
    expect(r.bulletins.machines[0]).toEqual({ name: "alpha", read: "autre-hote" });
  });

  it("a key readable by others: not used, no call made, MALADE", async () => {
    const { pass, calls } = setup(healthy, { keyOk: (p) => p !== "/k/beta-bulletin" });
    const r = await pass();
    expect(r.hosts[1]).toEqual({
      name: "beta",
      state: "MALADE",
      motifs: ["beta : cle du bulletin mal protegee — non utilisee"],
    });
    expect(r.bulletins.machines[1]).toEqual({ name: "beta", read: "cle" });
    expect(calls.map((a) => a.at(-1))).toEqual(["alpha.exemple.test"]);
  });

  it("the log's notes name the machine, never an address", async () => {
    const r = await setup({}).pass();
    expect(r.notes).toEqual(["alpha: ssh 255", "beta: ssh 255"]);
    expect(r.notes.join(" ")).not.toContain("exemple.test");
  });
});

describe("the call", () => {
  it("its own key, the pinned fingerprint, no command of ours — never an action key", async () => {
    const { pass, calls } = setup({});
    await pass();
    const args = calls[0] ?? [];
    expect(args).toContain("/k/alpha-bulletin");
    expect(args.join(" ")).toContain("StrictHostKeyChecking=yes");
    expect(args.join(" ")).toContain("UserKnownHostsFile=/k/known_hosts");
    // The address last, after "--": the server's forced command is the only one run.
    expect(args.slice(-2)).toEqual(["--", "alpha.exemple.test"]);
    expect(args.join(" ")).not.toMatch(/services|redemarrer|maj/);
  });
});

describe("no machine to judge: the page told why, no verdict", () => {
  const unreadable = (): string | null => {
    throw new Error("EACCES");
  };
  const cases: [string, () => string | null, "absent" | "illisible" | "ok"][] = [
    ["no file", () => null, "absent"],
    ["a file that cannot be read", unreadable, "illisible"],
    ["not TOML", () => "[[machine", "illisible"],
    ["an action key pasted in", () => `${CONFIG}cles = { services = "/k/x" }\n`, "illisible"],
    ["a joker of its own", () => CONFIG.replace('["tcp/22"]', '["tcp/*"]'), "illisible"],
    ["no machine named", () => 'known_hosts = "/k/known_hosts"\n', "ok"],
  ];
  it.each(cases)("%s", async (_what, readConfig, config) => {
    const { pass, calls } = setup(healthy, { readConfig });
    const r = await pass();
    expect(r.hosts).toEqual([]);
    expect(r.bulletins).toEqual({ at: NOW, config, machines: [] });
    expect(calls).toEqual([]);
  });
});
