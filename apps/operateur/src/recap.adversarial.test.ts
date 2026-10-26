// The maintenance summary sent by the operator (J7c): off, nothing at all;
// due, one message then one event — never the event before the message has
// left (a failed send is tried again); the morning with nothing to do counts
// as done without a word; my ask always answers, even "nothing"; an unusable
// serveurs.local.toml is said by its kind, never silent; the findings and the
// past restarts come from the stores, the keys from the operator's own list.
import type { StoredFinding } from "@cenacle/journal";
import { parseServers } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { type RecapDeps, runRecap } from "./recap.ts";

const NOW = new Date("2026-10-27T08:05:00Z"); // 9:05 in Paris
const CONFIG = parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services", redemarrer = "/Users/exemple/.ssh/cenacle/vps-b-redemarrer" }
`);
const finding = (type: string, count?: string) =>
  ({
    type,
    target: "vps-b",
    params: count === undefined ? {} : { count },
  }) as unknown as StoredFinding;

function world(over: Partial<RecapDeps> = {}) {
  const sent: string[] = [];
  const events: Record<string, unknown>[] = [];
  const keyboards: { text: string; callback_data: string }[][][] = [];
  const proposed: { id: number; steps: unknown[]; messageId: number | null }[] = [];
  let running: { id: number } | null = null;
  const deps: RecapDeps = {
    active: true,
    serversActive: true,
    config: CONFIG,
    findings: async () => [finding("serveur_services", "4")],
    lastRestarts: async () => new Map(),
    last: async () => ({ morning: null, any: null, asked: null }),
    send: async (text) => {
      sent.push(text);
    },
    sendWithButtons: async (text, rows) => {
      sent.push(text);
      keyboards.push(rows.map((r) => [...r]));
      return 900 + keyboards.length;
    },
    plans: {
      propose: async (steps) => {
        proposed.push({ id: 40 + proposed.length, steps: [...steps], messageId: null });
        return { id: 40 + proposed.length - 1, token: "a".repeat(16) };
      },
      setMessage: async (id, messageId) => {
        const p = proposed.find((x) => x.id === id);
        if (p !== undefined) p.messageId = messageId;
      },
      running: async () => running as never,
    },
    journal: {
      append: async (e) => {
        events.push({ type: e.type, agent: e.agent, ...(e.payload ?? {}) });
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
    ...over,
  };
  return {
    deps,
    sent,
    events,
    keyboards,
    proposed,
    planRuns: (id: number) => {
      running = { id };
    },
  };
}

describe("the operator's summary", () => {
  it("off: nothing read, nothing sent, nothing journaled", async () => {
    const w = world({
      active: false,
      findings: async () => {
        throw new Error("read while off");
      },
    });
    expect(await runRecap(w.deps)).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("the morning: one message, then its counts — the step and the key known", async () => {
    const w = world();
    expect(await runRecap(w.deps)).toBe(1);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("🔁 relancer les services (4)");
    expect(w.events).toEqual([
      { type: "maintenance.recap", agent: "operateur", quand: "matin", machines: 1, etapes: 1 },
    ]);
  });

  it("a key missing in serveurs.local.toml: the step said by hand", async () => {
    const w = world({ findings: async () => [finding("serveur_maj_securite", "2")] });
    await runRecap(w.deps);
    expect(w.sent[0]).toContain("à faire à la main (aucune clé)");
    expect(w.events[0]).toMatchObject({ etapes: 0 });
  });

  it("a failed send: no event, so the next pass tries again", async () => {
    const away = async () => {
      throw new Error("Telegram away");
    };
    const w = world({ send: away, sendWithButtons: away });
    await expect(runRecap(w.deps)).rejects.toThrow("Telegram away");
    expect(w.events).toEqual([]);
    // The plan it had proposed is never tied to a message that did not leave.
    expect(w.proposed[0]?.messageId).toBeNull();
  });

  it("something to do: the plan proposed, its buttons under the summary, the message tied to it", async () => {
    const w = world({
      findings: async () => [finding("serveur_maj_securite", "3"), finding("serveur_redemarrage")],
      config: parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services", redemarrer = "/Users/exemple/.ssh/cenacle/vps-b-redemarrer", maj_securite = "/Users/exemple/.ssh/cenacle/vps-b-maj" }
`),
    });
    expect(await runRecap(w.deps)).toBe(1);
    expect(w.proposed[0]?.steps).toEqual([
      { host: "vps-b", action: "maj_securite", conditional: false },
      { host: "vps-b", action: "services", conditional: true },
      { host: "vps-b", action: "redemarrer", conditional: false },
    ]);
    expect(w.keyboards[0]?.map((row) => row.map((b) => b.callback_data))).toEqual([
      [`m:v:40:${"a".repeat(16)}`],
      [`m:r:40:0:${"a".repeat(16)}`, `m:x:40:0:${"a".repeat(16)}`],
    ]);
    expect(w.proposed[0]?.messageId).toBe(901);
    expect(w.sent[0]).toMatch(/✅ Valider le plan lance ces étapes une à une/);
  });

  it("a plan running: no new plan, no button, said", async () => {
    const w = world();
    w.planRuns(12);
    await runRecap(w.deps);
    expect(w.proposed).toEqual([]);
    expect(w.keyboards).toEqual([]);
    expect(w.sent[0]).toMatch(/Le plan n°12 tourne encore : pas de bouton ici/);
  });

  it("the actions on the servers off: no plan, no button", async () => {
    const w = world({ serversActive: false });
    await runRecap(w.deps);
    expect(w.proposed).toEqual([]);
    expect(w.keyboards).toEqual([]);
    expect(w.sent[0]).toMatch(/Pas de plan tant que les actions sur les serveurs sont coupées/);
  });

  it("only steps by hand (no key): no plan, the summary says so", async () => {
    const w = world({ findings: async () => [finding("serveur_maj_securite", "2")] });
    await runRecap(w.deps);
    expect(w.proposed).toEqual([]);
    expect(w.sent[0]).toMatch(/Rien à valider ici/);
  });

  it("the morning with nothing to do: no message, but counted as done", async () => {
    const w = world({ findings: async () => [] });
    expect(await runRecap(w.deps)).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.events).toEqual([
      { type: "maintenance.recap", agent: "operateur", quand: "matin", machines: 0, etapes: 0 },
    ]);
  });

  it("my ask with nothing to do: still answered", async () => {
    const sentAt = new Date(NOW.getTime() - 3_600_000);
    const w = world({
      findings: async () => [],
      last: async () => ({ morning: sentAt, any: sentAt, asked: new Date(NOW.getTime() - 30_000) }),
    });
    expect(await runRecap(w.deps)).toBe(1);
    expect(w.sent).toEqual(["🧰 Rien à faire sur les serveurs."]);
    expect(w.events[0]).toMatchObject({ quand: "demande" });
  });

  it("not due: the stores are not even read", async () => {
    const sentAt = new Date(NOW.getTime() - 60_000);
    const w = world({
      last: async () => ({ morning: sentAt, any: sentAt, asked: null }),
      findings: async () => {
        throw new Error("read when not due");
      },
    });
    expect(await runRecap(w.deps)).toBe(0);
  });

  it("my ask when only the spared ones remain: nothing to do, and the memo said", async () => {
    const sentAt = new Date(NOW.getTime() - 3_600_000);
    const w = world({
      findings: async () => [finding("serveur_services", "5")],
      lastRestarts: async () => new Map([["vps-b", { exitCode: 125, finishedAt: NOW }]]),
      last: async () => ({ morning: sentAt, any: sentAt, asked: new Date(NOW.getTime() - 30_000) }),
    });
    await runRecap(w.deps);
    expect(w.sent[0]).toMatch(/^🧰 Rien à faire sur les serveurs\.\n\nPour mémoire.*vps-b \(5\)/s);
  });

  it("the morning when only the spared ones remain: silent", async () => {
    const w = world({
      findings: async () => [finding("serveur_services", "5")],
      lastRestarts: async () => new Map([["vps-b", { exitCode: 125, finishedAt: NOW }]]),
    });
    expect(await runRecap(w.deps)).toBe(0);
    expect(w.sent).toEqual([]);
  });

  it("serveurs.local.toml unusable: said by its kind, never a value; counted", async () => {
    const w = world({ config: "cle_inconnue" });
    expect(await runRecap(w.deps)).toBe(1);
    expect(w.sent[0]).toContain("(cle_inconnue)");
    expect(w.sent[0]).toContain("npm run serveurs:verifier");
    expect(w.sent[0]).not.toContain("/Users/");
    expect(w.events).toHaveLength(1);
  });

  it("the spared ones of the last restart: not offered again", async () => {
    const w = world({
      findings: async () => [finding("serveur_services", "5"), finding("serveur_redemarrage")],
      lastRestarts: async () => new Map([["vps-b", { exitCode: 125, finishedAt: NOW }]]),
    });
    await runRecap(w.deps);
    expect(w.sent[0]).not.toContain("🔁 relancer");
    expect(w.sent[0]).toContain("vps-b (5)");
  });
});
