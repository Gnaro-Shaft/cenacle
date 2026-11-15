// The file the ronde leaves for the page (ADR-0040, R2): the measures only,
// read back whole or not at all. What the ronde judges (ports, updates,
// quorum) never rides along, even if someone puts it in the file.
import { describe, expect, it } from "vitest";
import { parseBulletin } from "./bulletin.ts";
import {
  MAX_BULLETINS_FILE,
  measuresOnly,
  parseRondeBulletins,
  type RondeBulletins,
  RondeBulletinsError,
} from "./ronde-bulletins.ts";

const V2 = [
  "bulletin=1",
  "version=2",
  "hote=alpha-host",
  "instant=1794679266",
  "charge1=34",
  "charge5=24",
  "charge15=21",
  "processeurs=2",
  "memoire.totale=1000",
  "memoire.disponible=400",
  "disque.1.montage=/",
  "disque.1.pourcent=41",
  "disque.1.kilooctets=30832548",
  "redemarrage=requis",
  "maj.total=7",
  "maj.securite=2",
  "services.a_relancer=3",
  "grappe.quorum=non",
  "ports=tailnet/udp/41641,tcp/22",
  "fin=1",
].join("\n");

const FILE: RondeBulletins = {
  at: 1_794_679_300_000,
  config: "ok",
  machines: [
    { name: "alpha", read: "ok", bulletin: measuresOnly(parseBulletin(V2)) },
    { name: "beta", read: "injoignable" },
    { name: "gamma", read: "autre-hote" },
    { name: "delta", read: "cle" },
    { name: "epsilon", read: "illisible" },
  ],
};
const text = (f: unknown = FILE) => JSON.stringify(f);
type Json = Record<string, unknown>;
/** The file with one change made on its parsed form. */
const edit = (change: (f: Json) => void) => {
  const f = JSON.parse(text()) as Json;
  change(f);
  return JSON.stringify(f);
};
/** The first machine's measures, to change in place. */
const alpha = (f: Json) => ((f.machines as Json[])[0]?.bulletin ?? {}) as Json;
const push = (f: Json, m: Json) => (f.machines as Json[]).push(m);

describe("written, then read back", () => {
  it("as written, to the field", () => {
    expect(parseRondeBulletins(text())).toEqual(FILE);
  });

  it("a version 2 bulletin gives the page its measures, nothing the ronde judges", () => {
    for (const word of ["health", "version", "ports", "tailnet", "quorum", "reboot", "updates"]) {
      expect(text()).not.toContain(word);
    }
  });

  it("no configuration: said, with no machine", () => {
    const none = { at: 1, config: "absent", machines: [] };
    expect(parseRondeBulletins(text(none))).toEqual(none);
  });
});

describe("refused whole", () => {
  it.each([
    ["not JSON", "{"],
    ["a list", "[]"],
    ["a key of its own", edit((f) => Object.assign(f, { extra: 1 }))],
    ["no date", edit((f) => delete f.at)],
    ["a date in text", edit((f) => Object.assign(f, { at: "1794679300000" }))],
    ["a negative date", edit((f) => Object.assign(f, { at: -1 }))],
    ["a configuration of its own", edit((f) => Object.assign(f, { config: "partielle" }))],
    ["machines without a configuration", edit((f) => Object.assign(f, { config: "absent" }))],
    ["a machine twice", edit((f) => push(f, { name: "beta", read: "cle" }))],
    ["a name that is not a name", edit((f) => push(f, { name: "../x", read: "cle" }))],
    ["a reading of its own", edit((f) => push(f, { name: "zeta", read: "sain" }))],
    [
      "an unread machine carrying measures",
      edit((f) => push(f, { name: "zeta", read: "cle", bulletin: {} })),
    ],
    ["the ports riding along", edit((f) => Object.assign(alpha(f), { ports: ["tcp/22"] }))],
    ["the health riding along", edit((f) => Object.assign(alpha(f), { health: {} }))],
    ["a measure missing", edit((f) => delete alpha(f).cpus)],
    [
      "more memory free than there is",
      edit((f) => Object.assign(alpha(f), { memory: { total: 1, available: 2 } })),
    ],
    ["a load of two numbers", edit((f) => Object.assign(alpha(f), { load: [1, 2] }))],
    ["a load in text", edit((f) => Object.assign(alpha(f), { load: ["1", 2, 3] }))],
    [
      "a disk beyond 100 %",
      edit((f) => Object.assign(alpha(f), { disks: [{ mount: "/", percent: 101, kilobytes: 1 }] })),
    ],
    [
      "a mount that climbs",
      edit((f) =>
        Object.assign(alpha(f), { disks: [{ mount: "/a/../b", percent: 1, kilobytes: 1 }] }),
      ),
    ],
    ["a host name with a space", edit((f) => Object.assign(alpha(f), { host: "a b" }))],
    ["a fraction", edit((f) => Object.assign(alpha(f), { cpus: 1.5 }))],
  ])("%s", (_what, raw) => {
    expect(() => parseRondeBulletins(raw)).toThrow(RondeBulletinsError);
  });

  it("larger than any file the ronde writes", () => {
    const raw = text().padEnd(MAX_BULLETINS_FILE + 1, " ");
    expect(() => parseRondeBulletins(raw)).toThrow(RondeBulletinsError);
  });

  it("a prototype key never sneaks in as a field", () => {
    const raw = text().replace('"at":', '"__proto__":{"config":"ok"},"at":');
    expect(() => parseRondeBulletins(raw)).toThrow(RondeBulletinsError);
  });
});
