// When serveurs.local.toml cannot be used (2026-10-14): the operator refuses,
// keeps the kind of problem as its refusal, and says on Telegram what to fix
// and where to look (npm run serveurs:verifier) — never an address, a key path
// or a value from the file, whatever the file holds. A refusal stored before
// the kind was kept still reads as it did.
import {
  parseServers,
  SERVERS_CONFIG_PROBLEMS,
  ServersConfigError,
  type ServersConfigProblem,
} from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { message, runOperator } from "./run.ts";
import { type Row, world } from "./test-world.ts";

const problemOf = (text: string): ServersConfigProblem => {
  try {
    parseServers(text);
  } catch (error) {
    if (error instanceof ServersConfigError) return error.problem;
  }
  throw new Error("the file was read");
};

// The file of 2026-10-12, with fictitious values: Legion's ports in a block,
// then a block for a machine that holds no key.
const PASTED = `known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }
ports = ["tcp/22", "udp/41641"]
[[serveur]]
nom = "noeud-a"
adresse = "noeud-a.exemple.test"
compte = "cenacle"
`;

const told = async (problem: ServersConfigProblem): Promise<string> => {
  const w = world({ config: problem });
  await runOperator(w.deps);
  return w.sent[0] ?? "";
};

describe("serveurs.local.toml cannot be used", () => {
  it.each(SERVERS_CONFIG_PROBLEMS)(
    "%s: refused before anything runs, the kind kept and said",
    async (problem) => {
      const w = world({ config: problem });
      expect(await runOperator(w.deps)).toMatchObject({ ran: 0, refused: 1 });
      expect(w.calls).toEqual([]);
      expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: `config_${problem}` });
      expect(w.rows[0]?.refusal).toMatch(/^[a-z_]{1,40}$/);
      expect(w.sent[0]).toMatch(
        /^🛑 vps-b \(constat n°40\) : rien n'a été fait — .*serveurs\.local\.toml/,
      );
      expect(w.sent[0]).toMatch(/\(détail : npm run serveurs:verifier\)\.$/);
      expect(w.sent[0]).not.toMatch(/exemple\.test|\/Users\/|known_hosts =/);
    },
  );

  it("each kind has its own wording", async () => {
    const said = new Set<string>();
    for (const problem of SERVERS_CONFIG_PROBLEMS) said.add(await told(problem));
    expect(said.size).toBe(SERVERS_CONFIG_PROBLEMS.length);
  });

  it("the pasted file of 2026-10-12: the unknown key first, then the block without keys", async () => {
    expect(problemOf(PASTED)).toBe("cle_inconnue");
    const first = await told(problemOf(PASTED));
    expect(first).toMatch(/clé inconnue : seules nom, adresse, compte et cles sont admises/);
    const keysLeft = PASTED.replace(/ports = .*\n/, "");
    expect(problemOf(keysLeft)).toBe("cles");
    const second = await told(problemOf(keysLeft));
    expect(second).toMatch(/n'a pas de table cles : une machine sans clé n'y figure pas/);
    expect(`${first}${second}`).not.toMatch(/noeud-a|tcp\/22|exemple/);
  });

  it("a refusal stored before the kind was kept, or an unknown config code, still reads", () => {
    const row = world().rows[0] as Row;
    const old = { ...row, state: "refusee" as const, refusal: "configuration" };
    expect(message(old)).toMatch(/serveurs\.local\.toml est absent ou illisible\.$/);
    const odd = { ...row, state: "refusee" as const, refusal: "config_inexistant" };
    expect(message(odd)).toMatch(/refus de l'opérateur\.$/);
    expect(message(odd)).not.toMatch(/serveurs:verifier/);
  });
});
