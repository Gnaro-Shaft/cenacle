// The operator's pass under test (J6f): an in-memory store with the
// database's rules, a stand-in ssh, a controlled verdict of Legion — shared
// by the operator's adversarial tests.
import type { FinalState, ServerActionState, StoredServerAction, Verified } from "@cenacle/journal";
import { type Observation, parseServers } from "@cenacle/securite";
import type { OperatorDeps } from "./run.ts";

export const NOW = new Date("2026-10-11T10:00:00Z");
export const MIN = 60_000;
export const CONFIG = parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services", redemarrer = "/Users/exemple/.ssh/cenacle/vps-b-redemarrer", maj_securite = "/Users/exemple/.ssh/cenacle/vps-b-maj" }
`);
export const SEEN: Observation[] = [
  { type: "serveur_services", target: "vps-b", occurrence: "-", severity: "moyen", title: "x" },
];

export type Row = { -readonly [K in keyof StoredServerAction]: StoredServerAction[K] } & {
  told: boolean;
};

export function world(over: Partial<OperatorDeps> = {}, hosts: string[] = ["vps-b"]) {
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
