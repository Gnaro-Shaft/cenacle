// Actions on the servers, in the real database (J6f): a request is confirmed
// only with its token, within its 2 minutes, once; two actions never run at
// once, whatever the machine — the database refuses the second; a run cut
// off midway is failed and frees the way; outcomes are told once; a row goes
// 365 days after the request, never while it is pending.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSecuriteStore, type SeenFinding } from "./securite-store.ts";
import { createServeurActions } from "./serveur-actions.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  // Leave nothing running for the other tests' "one at a time".
  await sql`update serveur_actions set state = 'echouee', exit_code = -1, finished_at = now()
            where state = 'en_cours'`;
  await sql.end();
});
const actions = createServeurActions(sql);
const findings = createSecuriteStore(sql);
const T0 = new Date("2026-10-11T10:00:00Z");
const S = 1000;
const run = randomBytes(4).toString("hex");
const empty = { insert: [], promote: [], touch: [], resolve: [], drop: [] };
let n = 0;

async function finding(): Promise<number> {
  n += 1;
  const seen: SeenFinding = {
    check: "legion_ronde",
    type: "serveur_services",
    target: `vps-${run}-${n}`,
    occurrence: "-",
    severity: "moyen",
    title: "3 service(s) sur une bibliothèque remplacée",
  };
  await findings.apply({ ...empty, insert: [seen] }, T0);
  return (await findings.active()).find((f) => f.target === seen.target)?.id ?? 0;
}
const state = async (id: number) =>
  (await sql<{ state: string }[]>`select state from serveur_actions where id = ${id}`)[0]?.state;

describe("my confirmation", () => {
  it("with its token, within 2 minutes: confirmed; again: already", async () => {
    const r = await actions.request(await finding(), "vps-b", "services", T0);
    if (r === null) throw new Error("no request");
    expect(r.token).toMatch(/^[0-9a-f]{16}$/);
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 119 * S))).toBe("done");
    expect(await state(r.id)).toBe("confirmee");
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 120 * S))).toBe("already");
  });

  it("after 2 minutes: expired, never confirmed — before and after the pass marks it", async () => {
    const r = await actions.request(await finding(), "vps-b", "services", T0);
    if (r === null) throw new Error("no request");
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 121 * S))).toBe("expired");
    expect(await actions.expire(new Date(T0.getTime() + 121 * S))).toBeGreaterThanOrEqual(1);
    expect(await state(r.id)).toBe("expiree");
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 122 * S))).toBe("expired");
    expect(await state(r.id)).toBe("expiree");
  });

  it("a forged token, or not a token: nothing", async () => {
    const r = await actions.request(await finding(), "vps-b", "services", T0);
    if (r === null) throw new Error("no request");
    expect(await actions.confirm(r.id, "f".repeat(16), T0)).toBe("stale");
    expect(await actions.confirm(r.id, "' or 1=1 --", T0)).toBe("stale");
    expect(await state(r.id)).toBe("demandee");
  });

  it("one pending request per finding and action", async () => {
    const f = await finding();
    expect(await actions.request(f, "vps-b", "services", T0)).not.toBeNull();
    expect(await actions.request(f, "vps-b", "services", T0)).toBeNull();
  });
});

describe("one action at a time, whatever the machine", () => {
  it("a second claim is refused while one runs; a run cut off midway fails and frees the way", async () => {
    const ids: number[] = [];
    for (const host of ["vps-b", "vps-c"]) {
      const r = await actions.request(await finding(), host, "services", T0);
      if (r === null) throw new Error("no request");
      await actions.confirm(r.id, r.token, T0);
      ids.push(r.id);
    }
    const [a = 0, b = 0] = ids;
    expect(await actions.claim(a, T0)).toBe(true);
    expect(await actions.claim(b, T0)).toBe(false);
    expect(await state(b)).toBe("confirmee");
    expect(await actions.abandonStale(new Date(T0.getTime() + 6 * 60 * S))).toBeGreaterThanOrEqual(
      1,
    );
    expect(await state(a)).toBe("echouee");
    expect(await actions.claim(b, T0)).toBe(true);
    expect(await actions.finish(b, "faite", 0, T0)).toBe(true);
    expect(await actions.finish(b, "faite", 0, T0)).toBe(false);
  });

  it("a refusal is told once; a run's outcome is never a refusal", async () => {
    const r = await actions.request(await finding(), "vps-b", "services", T0);
    if (r === null) throw new Error("no request");
    await actions.confirm(r.id, r.token, T0);
    expect(await actions.refuse(r.id, "releve_perime", T0)).toBe(true);
    expect((await actions.toTell()).map((x) => x.id)).toContain(r.id);
    await actions.markTold([r.id]);
    expect((await actions.toTell()).map((x) => x.id)).not.toContain(r.id);
    await expect(actions.finish(r.id, "refusee", 0, T0)).rejects.toThrow(/not an outcome/);
  });
});

describe("a reboot (J6f2)", () => {
  it("done on a machine within 24 hours is known; another machine, or a services run, is not", async () => {
    const host = `vps-r${run}`;
    const r = await actions.request(await finding(), host, "redemarrer", T0);
    if (r === null) throw new Error("no request");
    await actions.confirm(r.id, r.token, T0);
    expect(await actions.claim(r.id, T0)).toBe(true);
    await actions.finish(r.id, "faite", 0, T0);
    const since = new Date(T0.getTime() - 24 * 3_600_000);
    expect(await actions.doneSince(host, "redemarrer", since)).toBe(true);
    expect(await actions.doneSince(host, "services", since)).toBe(false);
    expect(await actions.doneSince(`${host}x`, "redemarrer", since)).toBe(false);
    expect(await actions.doneSince(host, "redemarrer", new Date(T0.getTime() + 1000))).toBe(false);
    expect(await actions.verify(r.id, "pas_revenue", T0)).toBe(true);
  });
});

describe("the counts of a proof (2026-10-12)", () => {
  it("before at the run, after at the proof, read back; 'reduit' accepted", async () => {
    const r = await actions.request(await finding(), `vps-c${run}`, "services", T0);
    if (r === null) throw new Error("no request");
    await actions.confirm(r.id, r.token, T0);
    expect(await actions.claim(r.id, T0)).toBe(true);
    await actions.finish(r.id, "faite", 0, T0, 26);
    expect(await actions.verify(r.id, "reduit", T0, 8)).toBe(true);
    const told = (await actions.toTell()).find((a) => a.id === r.id);
    expect(told).toMatchObject({ verified: "reduit", beforeCount: 26, afterCount: 8 });
  });
});

describe("the purge", () => {
  it("365 days after the request; a recent request is kept", async () => {
    const old = new Date(T0.getTime() - 366 * 86_400_000);
    const gone = await actions.request(await finding(), "vps-b", "services", old);
    if (gone === null) throw new Error("no request");
    await actions.expire(new Date(old.getTime() + 121 * S));
    const kept = await actions.request(await finding(), "vps-b", "services", T0);
    await actions.purge(T0);
    expect(await state(gone.id)).toBeUndefined();
    expect(await state(kept?.id ?? 0)).toBe("demandee");
  });
});
