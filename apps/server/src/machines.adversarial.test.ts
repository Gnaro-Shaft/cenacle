// The machines' measures on the page (ADR-0040, R2): read from the ronde's
// file, never from a machine. A file missing, out of shape or too old is
// said as such — never shown as fresh, never half shown.
import { describe, expect, it } from "vitest";
import { createMachines, RONDE_STALE_MS } from "./machines.ts";

const AT = 1_794_679_300_000;
const FILE = {
  at: AT,
  config: "ok",
  machines: [
    {
      name: "alpha",
      read: "ok",
      bulletin: {
        host: "alpha-host",
        at: AT - 5000,
        uptimeSeconds: null,
        load: null,
        cpus: 2,
        memory: null,
        disks: [],
      },
      declared: ["copie-dumps"],
      backups: [
        {
          source: "copie-dumps",
          judgment: "sain",
          verdict: "SAIN",
          at: AT - 3_600_000,
          since: null,
          motifs: 0,
        },
      ],
    },
    { name: "beta", read: "injoignable", declared: ["copie-dumps"] },
  ],
};

const read = (raw: string | null, now = AT + 60_000) =>
  createMachines({ readFile: () => raw, now: () => now })();

const unreadable = (): string | null => {
  throw new Error("EACCES");
};

describe("the ronde's file", () => {
  it("read: each machine as the ronde found it, fresh", async () => {
    expect(await read(JSON.stringify(FILE))).toEqual({ ...FILE, ronde: "ok", stale: false });
  });

  it("a file from before the backups (S2b): unreadable until the ronde writes again, never half shown", async () => {
    const old = JSON.parse(JSON.stringify(FILE));
    for (const m of old.machines) {
      delete m.declared;
      delete m.backups;
    }
    expect(await read(JSON.stringify(old))).toMatchObject({ ronde: "illisible", machines: [] });
  });

  it("not written yet: said, no machine", async () => {
    expect(await read(null)).toEqual({
      ronde: "absente",
      at: null,
      stale: false,
      config: "absent",
      machines: [],
    });
  });

  it.each([
    ["cannot be read", unreadable],
    ["out of shape", () => "{}"],
    ["cut short", () => JSON.stringify(FILE).slice(0, 40)],
    [
      "carrying what the ronde judges",
      () => JSON.stringify(FILE).replace('"cpus":2', '"cpus":2,"ports":["tcp/22"]'),
    ],
  ])("%s: unreadable, no machine shown", async (_what, readFile) => {
    const view = await createMachines({ readFile, now: () => AT })();
    expect(view).toMatchObject({ ronde: "illisible", machines: [] });
  });

  it("four passes missed: shown, marked old; a minute less: fresh", async () => {
    expect((await read(JSON.stringify(FILE), AT + RONDE_STALE_MS + 1)).stale).toBe(true);
    expect((await read(JSON.stringify(FILE), AT + RONDE_STALE_MS - 60_000)).stale).toBe(false);
  });

  it("dated from the future beyond five minutes: marked", async () => {
    expect((await read(JSON.stringify(FILE), AT - 6 * 60_000)).stale).toBe(true);
    expect((await read(JSON.stringify(FILE), AT - 4 * 60_000)).stale).toBe(false);
  });
});
