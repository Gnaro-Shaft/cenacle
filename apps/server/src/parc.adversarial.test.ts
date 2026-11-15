// GET /api/parc (14/11): behind the page's token, only the listed fields;
// a verdict missing, unreadable, oversized, malformed or stale is said as
// such, never shown as healthy.
import type { ParcStore } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig, newToken } from "./guard.ts";
import { createParc, type ParcView } from "./parc.ts";
import type { ProposalsService } from "./proposals-service.ts";

const TOKEN = newToken();
const NOW = new Date("2026-11-14T18:00:00Z");
const PAGE = { host: "127.0.0.1:8787", authorization: `Bearer ${TOKEN}` };
const unused = async () => {
  throw new Error("unused");
};
const proposals: ProposalsService = {
  list: unused,
  edit: unused,
  accept: unused,
  refuse: unused,
  cancel: unused,
};

const store: ParcStore = {
  findings: async () => ({
    open: [
      { severity: "eleve", inCharge: false, title: "<img src=x onerror=alert(1)>", since: NOW },
    ],
    counts: { critique: 0, eleve: 1, moyen: 0, faible: 0, info: 0 },
    setAside: 1,
  }),
  lastRound: async () => ({ at: NOW, checks: 13, impossible: 1, network: true }),
  sentinel: async () => ({ up: true, since: NOW }),
};

const verdict = (minutesAgo: number) =>
  [
    "etat=SAIN",
    `instant=${Math.floor((NOW.getTime() - minutesAgo * 60_000) / 1000)}`,
    "hotes=1",
    "alpha.etat=SAIN",
    "fin=1",
  ].join("\n");

const parcWith = (readVerdict: () => string | null) =>
  createParc({ store, readVerdict, now: () => NOW });

function app(parc?: () => Promise<ParcView>) {
  return createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals,
    log: () => {},
    ...(parc === undefined ? {} : { parc }),
  });
}

describe("the route", () => {
  it("without the token, or with another: refused, nothing read", async () => {
    let read = 0;
    const parc = async () => {
      read++;
      return parcWith(() => verdict(1))();
    };
    for (const headers of [
      { host: "127.0.0.1:8787" },
      { host: "127.0.0.1:8787", authorization: `Bearer ${newToken()}` },
    ]) {
      expect((await app(parc).request("/api/parc", { headers })).status).toBe(401);
    }
    expect(read).toBe(0);
  });

  it("from a foreign host, even with the token: refused", async () => {
    const r = await app(parcWith(() => verdict(1))).request("/api/parc", {
      headers: { ...PAGE, host: "evil.example.test" },
    });
    expect(r.status).not.toBe(200);
  });

  it("not wired: said, not a crash", async () => {
    expect((await app().request("/api/parc", { headers: PAGE })).status).toBe(503);
  });

  it("with the token: exactly the listed fields; a title stays text", async () => {
    const r = await app(parcWith(() => verdict(1))).request("/api/parc", { headers: PAGE });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = (await r.json()) as ParcView;
    expect(Object.keys(body).sort()).toEqual([
      "at",
      "findings",
      "lastRound",
      "machines",
      "proxmox",
      "sentinel",
      "servers",
    ]);
    expect(Object.keys(body.findings).sort()).toEqual(["counts", "open", "setAside"]);
    expect(body.findings.open[0]?.title).toBe("<img src=x onerror=alert(1)>");
    expect(body.servers).toMatchObject({ read: "ok", stale: false, state: "SAIN" });
  });

  it("a store that fails: a silent 500, never the error's text", async () => {
    const failing = createParc({
      store: { ...store, findings: async () => Promise.reject(new Error("pg at /Users/x")) },
      readVerdict: () => verdict(1),
      now: () => NOW,
    });
    const r = await app(failing).request("/api/parc", { headers: PAGE });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("/Users/x");
  });
});

describe("the servers, never healthy by default", () => {
  const cases: readonly (readonly [string, () => string | null, "missing" | "unreadable"])[] = [
    ["no verdict on this Mac", () => null, "missing"],
    [
      "a verdict that cannot be read",
      () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
      "unreadable",
    ],
    ["a verdict cut short", () => verdict(1).replace("\nfin=1", ""), "unreadable"],
    ["a verdict far too large", () => `${verdict(1)}\n${"x".repeat(70_000)}`, "unreadable"],
  ];
  it.each(cases)("%s: %s", async (_what, read, expected) => {
    const view = await parcWith(read)();
    expect(view.servers).toEqual({ read: expected, source: "Legion" });
  });

  it("a stale verdict is shown, marked stale", async () => {
    const view = await parcWith(() => verdict(90))();
    expect(view.servers).toMatchObject({ read: "ok", stale: true });
  });
});

describe("the servers' verdict comes from the ronde securite.toml names (ADR-0040, R3)", () => {
  const withSource = (source: "legion" | "cenacle" | null, readVerdict: () => string | null) =>
    createParc({ store, readVerdict, source: () => source, now: () => NOW });

  it("Cénacle's: shown, its source named", async () => {
    const view = await withSource("cenacle", () => verdict(1))();
    expect(view.servers).toMatchObject({ read: "ok", source: "Cénacle", stale: false });
  });

  it("Cénacle's at 21 minutes: marked stale (four passes missed), where Legion's would not be", async () => {
    expect((await withSource("cenacle", () => verdict(21))()).servers).toMatchObject({
      stale: true,
    });
    expect((await withSource("legion", () => verdict(21))()).servers).toMatchObject({
      stale: false,
    });
  });

  it("no source named: nothing read, nothing shown as known", async () => {
    let read = 0;
    const view = await withSource(null, () => {
      read++;
      return verdict(1);
    })();
    expect(view.servers).toEqual({ read: "source", source: null });
    expect(read).toBe(0);
  });
});
