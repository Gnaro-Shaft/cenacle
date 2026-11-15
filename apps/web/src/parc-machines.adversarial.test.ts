// One card per machine (ADR-0039): every source under one name; a measure
// never invented — no source, no gauge; Proxmox first for a node; what could
// not be read said on the card.
import { describe, expect, it } from "vitest";
import type { BulletinView, ParcView, ProxmoxNodeView } from "./api.ts";
import { cardTone, gaugeTone, machinesOf, rondeNote } from "./parc-machines.ts";

/** The ronde passed a minute ago (ADR-0040): its file read, fresh. */
const RONDE_OK = { ronde: "ok", at: 0, stale: false, config: "ok" } as const;

const BULLETIN: BulletinView = {
  host: "alpha",
  at: 0,
  uptimeSeconds: 10,
  load: [200, 100, 50],
  cpus: 4,
  memory: { total: 1000, available: 250 },
  disks: [{ mount: "/", percent: 93, kilobytes: 1 }],
};
const NODE: ProxmoxNodeView = {
  name: "alpha",
  online: true,
  cpuPercent: 12,
  memory: { used: 4, total: 16 },
  uptimeSeconds: 10,
  guests: [{ id: 101, name: "nut", kind: "ct", running: true, cpuPercent: 1, memoryPercent: 30 }],
  disks: null,
};

function view(over: Partial<ParcView> = {}): ParcView {
  return {
    at: "2026-11-14T18:00:00Z",
    servers: {
      read: "ok",
      source: "Legion",
      state: "SOUFFRANT",
      at: "2026-11-14T17:50:00Z",
      stale: false,
      hosts: [
        { name: "alpha", state: "SAIN", motifs: [] },
        { name: "gamma", state: "SOUFFRANT", motifs: ["redémarrage requis"] },
      ],
    },
    findings: {
      counts: { critique: 0, eleve: 0, moyen: 0, faible: 0, info: 0 },
      setAside: 0,
      open: [],
    },
    lastRound: null,
    sentinel: null,
    machines: { ...RONDE_OK, machines: [{ name: "beta", read: "injoignable" }] },
    proxmox: null,
    ...over,
  };
}
const withBulletin = (b: BulletinView) =>
  view({ machines: { ...RONDE_OK, machines: [{ name: "alpha", read: "ok", bulletin: b }] } });

describe("one card per machine", () => {
  it("every name any source gives, once, sorted", () => {
    expect(machinesOf(view()).map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("no source measures it: no gauge, never a zero", () => {
    const gamma = machinesOf(view()).find((c) => c.name === "gamma");
    expect(gamma).toMatchObject({ cpu: null, memory: null, disks: [] });
    expect(gamma?.legion?.motifs).toEqual(["redémarrage requis"]);
  });

  it("a bulletin it could not read is said on the card", () => {
    const beta = machinesOf(view()).find((c) => c.name === "beta");
    expect(beta?.unread[0]).toMatch(/^bulletin injoignable/);
    expect(beta?.legion).toBeNull();
  });

  it("from the bulletin: load over processors, memory used, disks", () => {
    expect(machinesOf(withBulletin(BULLETIN))[0]).toMatchObject({
      cpu: 50,
      memory: 75,
      disks: [{ label: "/", percent: 93 }],
    });
  });

  it("a Proxmox node: Proxmox's processor and memory first, its guests on the card", () => {
    const both = { ...withBulletin(BULLETIN), proxmox: { read: "ok" as const, nodes: [NODE] } };
    const [alpha] = machinesOf(both);
    expect(alpha).toMatchObject({ cpu: 12, memory: 25 });
    expect(alpha?.node?.guests[0]?.name).toBe("nut");
    // The bulletin's disks still show: Proxmox does not measure the mounts.
    expect(alpha?.disks).toEqual([{ label: "/", percent: 93 }]);
  });

  it("a node Proxmox sees offline: said, and its old figures not used", () => {
    const [alpha] = machinesOf(
      view({ proxmox: { read: "ok", nodes: [{ ...NODE, online: false }] } }),
    );
    expect(alpha?.unread).toContain("nœud hors ligne pour Proxmox");
    expect(alpha?.cpu).toBeNull();
  });

  it("a stale Legion verdict is carried as stale, for the card to show it unknown", () => {
    const v = view();
    const servers = { ...v.servers, stale: true } as ParcView["servers"];
    expect(machinesOf({ ...v, servers })[0]?.legion?.stale).toBe(true);
  });

  it("numbers out of range are held in 0–100", () => {
    const wild: BulletinView = { ...BULLETIN, load: [9_999, 0, 0], cpus: 1 };
    expect(machinesOf(withBulletin(wild))[0]?.cpu).toBe(100);
  });
});

describe("the review's findings (ADR-0039)", () => {
  it("an online node whose disks could not be read: said, not taken for « no disk »", () => {
    const [alpha] = machinesOf(view({ proxmox: { read: "ok", nodes: [NODE] } }));
    expect(alpha?.unread).toContain("disques du nœud non lus");
  });

  it("the frame is the worst known: a red gauge on a healthy machine is red", () => {
    const [alpha] = machinesOf(withBulletin(BULLETIN));
    if (alpha === undefined) throw new Error("no card");
    expect(cardTone(alpha, "bon")).toBe("mauvais"); // its disk at 93 %
  });

  it("nothing known at all: unknown, never green", () => {
    const gamma = machinesOf(view()).find((c) => c.name === "gamma");
    if (gamma === undefined) throw new Error("no card");
    expect(cardTone({ ...gamma, legion: null }, null)).toBe("inconnu");
  });

  it("something unread lifts a healthy card to amber", () => {
    const beta = machinesOf(view()).find((c) => c.name === "beta");
    if (beta === undefined) throw new Error("no card");
    expect(cardTone(beta, "bon")).toBe("attention");
  });
});

describe("one machine, whatever case its name is written in (14/11)", () => {
  it("Legion's « alpha » and Proxmox's « Alpha »: one card, Legion's name, both sources on it", () => {
    const cards = machinesOf(
      view({
        machines: { ...RONDE_OK, machines: [{ name: "alpha", read: "ok", bulletin: BULLETIN }] },
        proxmox: { read: "ok", nodes: [{ ...NODE, name: "Alpha" }] },
      }),
    );
    expect(cards.filter((c) => c.name.toLowerCase() === "alpha")).toHaveLength(1);
    const [alpha] = cards;
    expect(alpha?.name).toBe("alpha");
    expect(alpha).toMatchObject({ cpu: 12, memory: 25, disks: [{ label: "/", percent: 93 }] });
    expect(alpha?.node?.guests[0]?.name).toBe("nut");
  });
});

describe("the gauges' colours", () => {
  it.each([
    [0, "bon"],
    [69, "bon"],
    [70, "attention"],
    [89, "attention"],
    [90, "mauvais"],
    [100, "mauvais"],
  ])("%d %% → %s", (p, tone) => {
    expect(gaugeTone(p)).toBe(tone);
  });
});

describe("the ronde's file, said when anything is off (ADR-0040)", () => {
  const machines = (over: Partial<NonNullable<ParcView["machines"]>>) => ({
    ...RONDE_OK,
    machines: [],
    ...over,
  });
  it.each([
    ["not written yet", machines({ ronde: "absente", at: null }), /pas encore tourné/],
    ["unreadable", machines({ ronde: "illisible", at: null }), /illisible/],
    ["too old", machines({ stale: true }), /ne passe plus/],
  ])("%s: said, never fresh by default", (_what, m, words) => {
    expect(rondeNote(m)).toMatch(words);
  });

  it("read and fresh: nothing to say; not wired: nothing either", () => {
    expect(rondeNote(machines({}))).toBeNull();
    expect(rondeNote(null)).toBeNull();
  });

  it("a bulletin from another machine: said on the card, no gauge from it", () => {
    const [alpha] = machinesOf(
      view({ machines: { ...RONDE_OK, machines: [{ name: "alpha", read: "autre-hote" }] } }),
    );
    expect(alpha?.unread).toEqual(["le bulletin vient d'une autre machine que celle déclarée"]);
    expect(alpha?.cpu).toBeNull();
    expect(alpha?.disks).toEqual([]);
  });
});
