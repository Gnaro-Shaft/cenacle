// What the Parc tab reads in the base (14/11), on the real test database,
// with the application's role: open findings only, counted whole, listed
// worst first, set-aside ones counted apart — and never a finding's button
// token, action or params in what leaves the store.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParcStore, MAX_LISTED } from "./parc-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const store = createParcStore(sql);
const DAY = 86_400_000;
let n = 0;
/** A finding's button (its 16 hex digits): never in what the store gives. */
const BUTTON = "0123456789abcdef";

async function finding(
  severity: string,
  status: string,
  title: string,
  daysAgo = 1,
  extra: { readonly token?: string } = {},
) {
  n++;
  const seen = new Date(Date.now() - daysAgo * DAY);
  const closed = status === "resolu" || status === "caduc" ? new Date() : null;
  const accepted = status === "accepte" ? new Date() : null;
  await sql`
    insert into securite_constats
      (type, target, occurrence, check_name, severity, title, params, status,
       first_seen, last_seen, closed_at, reason, accepted_at, button_token)
    values ('parc_probe', ${`t${n}`}, '-', 'parc_probe', ${severity}, ${title},
       ${sql.json({ hidden: "params-never-shown" })}, ${status}, ${seen}, ${seen}, ${closed},
       ${accepted === null ? null : "risque pris"}, ${accepted}, ${extra.token ?? null})`;
}

beforeAll(async () => {
  await sql`delete from securite_constats`;
  await finding("moyen", "ouvert", "un moyen ancien", 9, { token: BUTTON });
  await finding("critique", "ouvert", "un critique", 1);
  await finding("moyen", "ouvert", "un moyen récent", 1);
  await finding("eleve", "pris_en_charge", "un élevé en cours", 2);
  await finding("eleve", "candidat", "un candidat, pas encore dit", 0);
  await finding("moyen", "resolu", "un résolu", 3);
  await finding("faible", "caduc", "un caduc", 3);
  await finding("moyen", "accepte", "un risque accepté", 4);
  await finding("faible", "refuse", "un correctif écarté", 4);
});

afterAll(async () => {
  await sql`delete from securite_constats where type = 'parc_probe'`;
  await sql.end();
});

describe("the open findings", () => {
  it("only the open ones, worst first then oldest; set-aside counted apart", async () => {
    const f = await store.findings();
    expect(f.open.map((o) => o.title)).toEqual([
      "un critique",
      "un élevé en cours",
      "un moyen ancien",
      "un moyen récent",
    ]);
    expect(f.open[1]?.inCharge).toBe(true);
    expect(f.counts).toEqual({ critique: 1, eleve: 1, moyen: 2, faible: 0, info: 0 });
    expect(f.setAside).toBe(2);
  });

  it("nothing but the four safe fields leaves the store: no token, no params, no action", async () => {
    const f = await store.findings();
    for (const o of f.open) {
      expect(Object.keys(o).sort()).toEqual(["inCharge", "severity", "since", "title"]);
    }
    expect(JSON.stringify(f)).not.toContain(BUTTON);
    expect(JSON.stringify(f)).not.toContain("params-never-shown");
  });

  it("the list is capped, the counts never are; the worst are never cut for the least", async () => {
    for (let i = 0; i < MAX_LISTED + 5; i++) await finding("info", "ouvert", `info ${i}`, 1);
    const f = await store.findings();
    expect(f.open).toHaveLength(MAX_LISTED);
    expect(f.counts.info).toBe(MAX_LISTED + 5);
    expect(f.open[0]?.title).toBe("un critique");
    await sql`delete from securite_constats where type = 'parc_probe' and severity = 'info'`;
  });
});

describe("the last round and the sentinel", () => {
  it("the latest round, its counts read safely; a payload out of shape counts as 0", async () => {
    await sql`insert into events (agent, type, payload) values ('securite', 'securite.ran', ${sql.json({ checks: 13, impossible: 1, network: true })})`;
    expect(await store.lastRound()).toMatchObject({ checks: 13, impossible: 1, network: true });
    await sql`insert into events (agent, type, payload) values ('securite', 'securite.ran', ${sql.json({ checks: "13; drop", impossible: -2, network: "yes" })})`;
    expect(await store.lastRound()).toMatchObject({ checks: 0, impossible: 0, network: false });
  });

  it("the sentinel: its latest word decides, reached or not", async () => {
    await sql`insert into events (agent, type, payload) values ('sentinel', 'sentinel.unreachable', '{}')`;
    expect((await store.sentinel())?.up).toBe(false);
    await sql`insert into events (agent, type, payload) values ('sentinel', 'sentinel.reached', ${sql.json({ minutes: 1 })})`;
    expect((await store.sentinel())?.up).toBe(true);
    await sql`insert into events (agent, type, payload) values ('sentinel', 'sentinel.link', ${sql.json({ up: false })})`;
    expect((await store.sentinel())?.up).toBe(false);
  });
});
