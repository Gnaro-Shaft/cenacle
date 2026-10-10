// My decisions from Telegram, in the real database (J6b): a decision applies
// only with the finding's token and only to a finding still to fix; a
// replay, a forged token or a double tap changes nothing; a resolved finding
// loses its token; a reason counts only as a reply to the question, before
// its deadline, and of a sensible length.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSecuriteDecisions } from "./securite-decisions.ts";
import { createSecuriteStore, type SeenFinding } from "./securite-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createSecuriteStore(sql);
const decisions = createSecuriteDecisions(sql);
const T0 = new Date("2026-10-11T05:30:00Z");
const MIN = 60_000;
const run = randomBytes(4).toString("hex");
const empty = { insert: [], promote: [], touch: [], resolve: [], drop: [] };
let n = 0;
let prompt = Math.floor(Math.random() * 1e9);

/** An open finding, as two sightings make it. */
async function openFinding(): Promise<number> {
  n += 1;
  const seen: SeenFinding = {
    check: "firewall",
    type: "firewall_off",
    target: `mac-${run}-${n}`,
    occurrence: "off",
    severity: "moyen",
    title: "Le pare-feu de macOS est désactivé",
  };
  await store.apply({ ...empty, insert: [seen] }, T0);
  const f = (await store.active()).find((x) => x.target === seen.target);
  await store.apply({ ...empty, promote: [{ id: f?.id ?? 0, seen }] }, T0);
  return f?.id ?? 0;
}
const status = async (id: number) =>
  (await sql<{ status: string }[]>`select status from securite_constats where id = ${id}`)[0]
    ?.status;

describe("decisions with a token", () => {
  it("a token is created once and kept; a candidate gets none", async () => {
    const id = await openFinding();
    const first = (await decisions.tokens([id])).get(id);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect((await decisions.tokens([id])).get(id)).toBe(first);
    expect((await decisions.tokens([987_654_321])).size).toBe(0);
  });

  it("✅ with the right token: taken in hand; again: already; a forged token: stale", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    expect(await decisions.decide(id, "f".repeat(16), "take", T0)).toBe("stale");
    expect(await decisions.decide(id, "not a token", "take", T0)).toBe("stale");
    expect(await decisions.decide(id, token, "take", T0)).toBe("done");
    expect(await status(id)).toBe("pris_en_charge");
    expect(await decisions.decide(id, token, "take", T0)).toBe("already");
  });

  it("❌ refuses, even after ✅; the token is then spent", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    await decisions.decide(id, token, "take", T0);
    expect(await decisions.decide(id, token, "refuse", T0)).toBe("done");
    expect(await status(id)).toBe("refuse");
    expect(await decisions.decide(id, token, "refuse", T0)).toBe("already");
  });

  it("a finding resolved meanwhile: its button says already", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    await store.apply({ ...empty, resolve: [id] }, T0);
    expect(await decisions.decide(id, token, "take", T0)).toBe("already");
    expect(await decisions.check(id, token)).toBe("already");
  });
});

describe("keeping a risk: the reason", () => {
  it("a reply to the question, in time: the risk is kept, the question gone", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    expect(await decisions.check(id, token)).toBe("done");
    prompt += 1;
    await decisions.askReason(prompt, id, new Date(T0.getTime() + 10 * MIN));
    expect(await decisions.isAsking(prompt, T0)).toBe(true);
    expect(await decisions.giveReason(prompt, "  mise à jour   vendredi ", T0)).toBe("done");
    expect(await status(id)).toBe("accepte");
    expect(await decisions.isAsking(prompt, T0)).toBe(false);
    expect(await decisions.giveReason(prompt, "encore", T0)).toBe("unknown");
    expect(await decisions.check(id, token)).toBe("already");
  });

  it("too late: nothing changes; a message that was no question: unknown", async () => {
    const id = await openFinding();
    prompt += 1;
    await decisions.askReason(prompt, id, new Date(T0.getTime() + 10 * MIN));
    expect(await decisions.isAsking(prompt, new Date(T0.getTime() + 11 * MIN))).toBe(false);
    expect(await decisions.giveReason(prompt, "trop tard", new Date(T0.getTime() + 11 * MIN))).toBe(
      "expired",
    );
    expect(await status(id)).toBe("ouvert");
    expect(await decisions.giveReason(424_242, "au hasard", T0)).toBe("unknown");
  });

  it("a reason too short or too long is refused, and the question still stands", async () => {
    const id = await openFinding();
    prompt += 1;
    await decisions.askReason(prompt, id, new Date(T0.getTime() + 10 * MIN));
    await expect(decisions.giveReason(prompt, " x ", T0)).rejects.toThrow(/reason/);
    await expect(decisions.giveReason(prompt, "y".repeat(201), T0)).rejects.toThrow(/reason/);
    expect(await decisions.isAsking(prompt, T0)).toBe(true);
  });

  it("the finding decided otherwise meanwhile: already", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    prompt += 1;
    await decisions.askReason(prompt, id, new Date(T0.getTime() + 10 * MIN));
    await decisions.decide(id, token, "refuse", T0);
    expect(await decisions.giveReason(prompt, "garder quand même", T0)).toBe("already");
    expect(await status(id)).toBe("refuse");
  });

  it("questions past their deadline are purged", async () => {
    const id = await openFinding();
    prompt += 1;
    await decisions.askReason(prompt, id, new Date(T0.getTime() + MIN));
    expect(await decisions.purge(new Date(T0.getTime() + 2 * MIN))).toBeGreaterThanOrEqual(1);
    expect(await decisions.giveReason(prompt, "plus tard", T0)).toBe("unknown");
  });
});

describe("the refused, asked again", () => {
  it("purged 30 days after the decision", async () => {
    const id = await openFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    await decisions.decide(id, token, "refuse", T0);
    await store.purge(new Date(T0.getTime() + 29 * 24 * 60 * MIN));
    expect(await status(id)).toBe("refuse");
    await store.purge(new Date(T0.getTime() + 31 * 24 * 60 * MIN));
    expect(await status(id)).toBeUndefined();
  });
});
