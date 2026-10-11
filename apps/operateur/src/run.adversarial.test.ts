// The operator's pass (J6f), with an in-memory store, a stand-in ssh and a
// controlled verdict: before acting, everything is checked again — the
// switch, the machine, its key, a verdict under 35 minutes that still shows
// the problem; one action per pass, none while another runs; the exit code
// alone decides the outcome; a later verdict proves it, an earlier one never;
// a message that fails goes again; an address or a key path is never told.
import type { FinalState, ServerActionState, StoredServerAction, Verified } from "@cenacle/journal";
import { type Observation, parseServers } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { message, type OperatorDeps, runOperator } from "./run.ts";

const NOW = new Date("2026-10-11T10:00:00Z");
const MIN = 60_000;
const CONFIG = parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services", redemarrer = "/Users/exemple/.ssh/cenacle/vps-b-redemarrer" }
`);
const SEEN: Observation[] = [
  { type: "serveur_services", target: "vps-b", occurrence: "-", severity: "moyen", title: "x" },
];

type Row = { -readonly [K in keyof StoredServerAction]: StoredServerAction[K] } & { told: boolean };

function world(over: Partial<OperatorDeps> = {}, hosts: string[] = ["vps-b"]) {
  const rows: Row[] = hosts.map((host, i) => ({
    id: i + 1,
    findingId: 40 + i,
    host,
    action: "services",
    state: "confirmee",
    requestedAt: NOW,
    finishedAt: null,
    exitCode: null,
    refusal: null,
    verified: null,
    told: true,
  }));
  const calls: string[][] = [];
  const sent: string[] = [];
  const events: Record<string, unknown>[] = [];
  let verdictAt = NOW.getTime() - 5 * MIN;
  let seen = SEEN;
  let hostEtat = "SOUFFRANT";
  let rebootedRecently = false;
  const set = (id: number, patch: Partial<Row>) => {
    const r = rows.find((x) => x.id === id);
    if (r !== undefined) Object.assign(r, patch);
  };
  const FINAL: ServerActionState[] = [
    "expiree",
    "faite",
    "rien_a_faire",
    "refusee_serveur",
    "refusee",
    "echouee",
  ];
  const deps: OperatorDeps = {
    store: {
      expire: async () => 0,
      abandonStale: async () => 0,
      next: async () => rows.find((r) => r.state === "confirmee") ?? null,
      doneSince: async () => rebootedRecently,
      claim: async (id) => {
        if (rows.some((r) => r.state === "en_cours")) return false;
        set(id, { state: "en_cours" });
        return true;
      },
      refuse: async (id, refusal, now) => {
        set(id, { state: "refusee", refusal, finishedAt: now, told: false });
        return true;
      },
      finish: async (id, state: FinalState, exitCode, now) => {
        set(id, { state, exitCode, finishedAt: now, told: false });
        return true;
      },
      toVerify: async () => rows.filter((r) => r.state === "faite" && r.verified === null),
      verify: async (id, verified: Verified) => {
        set(id, { verified, told: false });
        return true;
      },
      toTell: async () => rows.filter((r) => !r.told && FINAL.includes(r.state)),
      markTold: async (ids) => {
        for (const id of ids) set(id, { told: true });
      },
      purge: async () => 0,
    },
    active: true,
    config: CONFIG,
    verdict: () =>
      `bulletin=1\ninstant=${Math.floor(verdictAt / 1000)}\nvps-b.etat=${hostEtat}\nfin=1`,
    parseVerdict: () => seen,
    keyIsPrivate: () => true,
    ssh: async (args) => {
      calls.push([...args]);
      return 0;
    },
    send: async (text) => {
      sent.push(text);
    },
    journal: {
      append: async (e) => {
        events.push(e.payload ?? {});
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
    ...over,
  };
  return {
    deps,
    rows,
    calls,
    sent,
    events,
    verdictAt: (ms: number) => {
      verdictAt = ms;
    },
    seen: (s: Observation[]) => {
      seen = s;
    },
    hostEtat: (e: string) => {
      hostEtat = e;
    },
    rebootedRecently: () => {
      rebootedRecently = true;
    },
  };
}

describe("before acting, everything again", () => {
  it("all holds: one fixed ssh call, no command; done, told, journaled as counts", async () => {
    const w = world();
    expect(await runOperator(w.deps)).toMatchObject({ ran: 1, refused: 0, told: 1 });
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]?.slice(-2)).toEqual(["--", "vps-b.exemple.test"]);
    expect(w.rows[0]).toMatchObject({ state: "faite", exitCode: 0 });
    expect(w.sent[0]).toMatch(
      /^🔁 vps-b \(constat n°40\) : relancer les services.*fait\. J'attends/,
    );
    expect(w.events).toEqual([{ action: "services", outcome: "faite" }]);
  });

  it.each([
    ["the switch off", { active: false }, "interrupteur", /coupées/],
    ["no configuration", { config: null }, "configuration", /serveurs\.local\.toml/],
    ["a key others can read", { keyIsPrivate: () => false }, "cle_mal_protegee", /chmod 600/],
    ["no verdict", { verdict: () => null }, "releve_perime", /plus de 35 minutes/],
    [
      "a verdict that cannot be read",
      {
        parseVerdict: () => {
          throw new Error("x");
        },
      },
      "releve_illisible",
      /illisible/,
    ],
  ] as const)("%s: refused, nothing run, said", async (_label, over, refusal, said) => {
    const w = world(over as Partial<OperatorDeps>);
    expect(await runOperator(w.deps)).toMatchObject({ ran: 0, refused: 1 });
    expect(w.calls).toEqual([]);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal });
    expect(w.sent[0]).toMatch(said);
    expect(w.sent[0]).not.toMatch(/exemple\.test|\/Users\//);
  });

  it("a machine I did not declare: refused", async () => {
    const w = world({}, ["vps-z"]);
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "machine_inconnue" });
    expect(w.calls).toEqual([]);
  });

  it("a verdict 34 minutes old acts (two 15-minute cycles); 36 old, or from the future: refused", async () => {
    const ok = world();
    ok.verdictAt(NOW.getTime() - 34 * MIN);
    await runOperator(ok.deps);
    expect(ok.rows[0]).toMatchObject({ state: "faite" });
    for (const at of [NOW.getTime() - 36 * MIN, NOW.getTime() + 6 * MIN]) {
      const w = world();
      w.verdictAt(at);
      await runOperator(w.deps);
      expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "releve_perime" });
      expect(w.calls).toEqual([]);
    }
  });

  it("the verdict no longer shows the problem on that machine: nothing to do", async () => {
    const w = world();
    w.seen([{ ...SEEN[0], target: "vps-c" } as Observation]);
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "plus_de_motif" });
    expect(w.calls).toEqual([]);
  });
});

describe("one at a time", () => {
  it("one request per pass; another running: this one waits, untouched", async () => {
    const w = world({}, ["vps-b", "vps-b"]);
    await runOperator(w.deps);
    expect(w.calls).toHaveLength(1);
    expect(w.rows[1]?.state).toBe("confirmee");
    const busy = world();
    busy.rows.push({ ...(busy.rows[0] as Row), id: 9, state: "en_cours" });
    await runOperator(busy.deps);
    expect(busy.calls).toEqual([]);
    expect(busy.rows[0]?.state).toBe("confirmee");
  });
});

describe("the exit code alone decides", () => {
  it.each([
    [10, "rien_a_faire", /rien à faire/],
    [11, "refusee_serveur", /garde-fou du serveur/],
    [12, "echouee", /a échoué \(code 12\)/],
    [255, "echouee", /injoignable ou clé refusée/],
    [-1, "echouee", /coupée en cours/],
  ] as const)("%i → %s", async (code, state, said) => {
    const w = world({ ssh: async () => code });
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state, exitCode: code });
    expect(w.sent[0]).toMatch(said);
  });
});

describe("the proof", () => {
  it("a verdict written before the action proves nothing; a later one does", async () => {
    const w = world();
    await runOperator(w.deps);
    const done = w.rows[0] as Row;
    done.finishedAt = new Date(NOW.getTime() - MIN);
    w.verdictAt(NOW.getTime() - 2 * MIN);
    expect((await runOperator(w.deps)).verified).toBe(0);
    w.verdictAt(NOW.getTime());
    w.seen([]);
    expect((await runOperator(w.deps)).verified).toBe(1);
    expect(done.verified).toBe("disparu");
    expect(w.sent.at(-1)).toMatch(/^✅ vps-b .* l'action a pris/);
  });

  it("still there after the action: said", async () => {
    const w = world();
    await runOperator(w.deps);
    (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - MIN);
    w.verdictAt(NOW.getTime());
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("toujours_la");
    expect(w.sent.at(-1)).toMatch(/^⚠ vps-b .* montre encore le problème/);
  });
});

describe("what must not be lost", () => {
  it("a message that fails is told again at the next pass", async () => {
    let fail = true;
    const w = world({
      send: async (text) => {
        if (fail) throw new Error("Telegram unreachable");
        w.sent.push(text);
      },
    });
    await expect(runOperator(w.deps)).rejects.toThrow(/Telegram/);
    expect(w.rows[0]).toMatchObject({ state: "faite", told: false });
    fail = false;
    await runOperator(w.deps);
    expect(w.sent).toHaveLength(1);
  });

  it("an expired request is said plainly", () => {
    expect(message({ ...(world().rows[0] as Row), state: "expiree" })).toBe(
      "⌛ vps-b (constat n°40) : demande non confirmée dans les 2 minutes, rien n'a été fait.",
    );
  });
});

describe("a reboot (J6f2)", () => {
  const REBOOT: Observation[] = [
    {
      type: "serveur_redemarrage",
      target: "vps-b",
      occurrence: "-",
      severity: "moyen",
      title: "x",
    },
  ];
  const reboot = (over: Partial<OperatorDeps> = {}) => {
    const w = world(over);
    (w.rows[0] as Row).action = "redemarrer";
    w.seen(REBOOT);
    return w;
  };

  it("all holds: its own key, never the services one; scheduled, said", async () => {
    const w = reboot();
    await runOperator(w.deps);
    expect(w.calls[0]).toContain("/Users/exemple/.ssh/cenacle/vps-b-redemarrer");
    expect(w.calls[0]).not.toContain("/Users/exemple/.ssh/cenacle/vps-b-services");
    expect(w.sent[0]).toMatch(/^🔄 vps-b \(constat n°40\) : redémarrage programmé dans 1 minute/);
  });

  it("already rebooted by Cénacle within 24 hours: refused before any call", async () => {
    const w = reboot();
    w.rebootedRecently();
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "redemarrage_recent" });
    expect(w.calls).toEqual([]);
    expect(w.sent[0]).toMatch(/moins de 24 heures/);
  });

  it("a machine with a services key only: no reboot", async () => {
    const services = parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }
`);
    const w = reboot({ config: services });
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "pas_de_cle" });
    expect(w.calls).toEqual([]);
  });

  it("the proof: not before 3 minutes; back and nothing required: said back", async () => {
    const w = reboot();
    await runOperator(w.deps);
    const done = w.rows[0] as Row;
    done.finishedAt = new Date(NOW.getTime() - 10 * MIN);
    w.verdictAt(NOW.getTime() - 8 * MIN);
    w.seen([]);
    w.hostEtat("SAIN");
    expect((await runOperator(w.deps)).verified).toBe(0);
    w.verdictAt(NOW.getTime() - 6 * MIN);
    expect((await runOperator(w.deps)).verified).toBe(1);
    expect(done.verified).toBe("disparu");
    expect(w.sent.at(-1)).toMatch(/^✅ vps-b \(constat n°40\) est revenue/);
  });

  it("still unreachable: patience until 30 minutes, then one loud alert", async () => {
    const w = reboot();
    await runOperator(w.deps);
    const done = w.rows[0] as Row;
    w.hostEtat("MALADE");
    done.finishedAt = new Date(NOW.getTime() - 20 * MIN);
    w.verdictAt(NOW.getTime() - 2 * MIN);
    expect((await runOperator(w.deps)).verified).toBe(0);
    done.finishedAt = new Date(NOW.getTime() - 31 * MIN);
    expect((await runOperator(w.deps)).verified).toBe(1);
    expect(done.verified).toBe("pas_revenue");
    expect(w.sent.at(-1)).toMatch(/^🚨 vps-b \(constat n°40\) n'est pas revenue 30 minutes/);
    const told = w.sent.length;
    await runOperator(w.deps);
    expect(w.sent).toHaveLength(told);
  });

  it("no verdict at all 30 minutes on: the same alert — silence proves nothing", async () => {
    const w = reboot();
    await runOperator(w.deps);
    (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - 31 * MIN);
    await runOperator({ ...w.deps, verdict: () => null });
    expect(w.rows[0]?.verified).toBe("pas_revenue");
  });

  it("back, but a reboot still required: said, to look at", async () => {
    const w = reboot();
    await runOperator(w.deps);
    (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - 10 * MIN);
    w.verdictAt(NOW.getTime());
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("toujours_la");
    expect(w.sent.at(-1)).toMatch(/demande encore un redémarrage/);
  });
});
