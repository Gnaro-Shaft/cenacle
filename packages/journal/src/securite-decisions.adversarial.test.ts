// My decisions from Telegram, in the real database (J6b): a decision applies
// only with the finding's token and only to a finding still to fix; a
// replay, a forged token or a double tap changes nothing; a resolved finding
// loses its token; a reason counts only as a reply to the question, before
// its deadline, and of a sensible length. On a CERT-FR bulletin, ✅ means
// done: quiet for it, with the reason written for me (J6e3).
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
async function openFinding(type = "firewall_off"): Promise<number> {
  n += 1;
  const seen: SeenFinding = {
    check: "firewall",
    type,
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

describe("✅ on a CERT-FR bulletin (J6e3)", () => {
  it("treated: quiet like a kept risk, the reason written; a double tap changes nothing", async () => {
    for (const type of ["bulletin_alerte", "bulletin_avis"]) {
      const id = await openFinding(type);
      const token = (await decisions.tokens([id])).get(id) ?? "";
      expect(await decisions.decide(id, token, "take", T0)).toBe("treated");
      const [row] = await sql<{ status: string; reason: string; button_token: string | null }[]>`
        select status, reason, button_token from securite_constats where id = ${id}`;
      expect(row).toEqual({ status: "accepte", reason: "Traité (✅)", button_token: null });
      expect(await decisions.decide(id, token, "take", T0)).toBe("already");
      expect(await status(id)).toBe("accepte");
    }
  });

  it("a forged token on a bulletin: nothing; ❌ on a bulletin: refused as before", async () => {
    const id = await openFinding("bulletin_avis");
    expect(await decisions.decide(id, "f".repeat(16), "take", T0)).toBe("stale");
    expect(await status(id)).toBe("ouvert");
    const token = (await decisions.tokens([id])).get(id) ?? "";
    expect(await decisions.decide(id, token, "refuse", T0)).toBe("done");
    expect(await status(id)).toBe("refuse");
  });
});

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

describe("🔧 requesting a fix (J6c)", () => {
  async function npmFinding(withFix = true): Promise<number> {
    n += 1;
    const seen: SeenFinding = {
      check: "npm_audit",
      type: "npm_advisory",
      target: `pkg-${run}-${n}`,
      occurrence: "1101",
      severity: "eleve",
      title: "Faille",
      params: withFix ? { fixName: "left-pad", fixVersion: "1.3.1" } : { auditFix: "1" },
    };
    await store.apply({ ...empty, insert: [seen] }, T0);
    const f = (await store.active()).find((x) => x.target === seen.target);
    await store.apply({ ...empty, promote: [{ id: f?.id ?? 0, seen }] }, T0);
    return f?.id ?? 0;
  }

  it("a dependency with a fix: noted once, taken in hand; again: already", async () => {
    const id = await npmFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    expect(await decisions.requestFix(id, token, T0)).toBe("done");
    expect(await status(id)).toBe("pris_en_charge");
    expect((await store.pendingFixes()).map((f) => f.id)).toContain(id);
    expect(await decisions.requestFix(id, token, T0)).toBe("already");
  });

  it("anything else: not fixable; a forged token: stale", async () => {
    const fw = await openFinding();
    const t1 = (await decisions.tokens([fw])).get(fw) ?? "";
    expect(await decisions.requestFix(fw, t1, T0)).toBe("not_fixable");
    const noFix = await npmFinding(false);
    const t2 = (await decisions.tokens([noFix])).get(noFix) ?? "";
    expect(await decisions.requestFix(noFix, t2, T0)).toBe("not_fixable");
    expect(await decisions.requestFix(noFix, "f".repeat(16), T0)).toBe("stale");
  });

  it("a failed preparation may be asked again; an opened PR is followed", async () => {
    const id = await npmFinding();
    const token = (await decisions.tokens([id])).get(id) ?? "";
    await decisions.requestFix(id, token, T0);
    await store.setAction(id, "echouee");
    expect(await decisions.requestFix(id, token, T0)).toBe("done");
    await store.setAction(id, "pr_ouverte", "https://github.com/o/r/pull/12");
    expect((await store.openPullRequests()).find((f) => f.id === id)?.actionPrUrl).toBe(
      "https://github.com/o/r/pull/12",
    );
    await expect(
      store.setAction(id, "pr_ouverte", "https://evil.example/pull/1"),
    ).rejects.toThrow();
  });
});

describe("✅ / ❌ under a pull request, and delegation (J6d)", () => {
  async function withPr(state: "ci_verte" | "pr_ouverte"): Promise<[number, string]> {
    n += 1;
    const seen: SeenFinding = {
      check: "npm_audit",
      type: "npm_advisory",
      target: `pr-${run}-${n}`,
      occurrence: "1",
      severity: "eleve",
      title: "Faille",
      params: { fixName: "left-pad", fixVersion: "1.3.1" },
    };
    await store.apply({ ...empty, insert: [seen] }, T0);
    const f = (await store.active()).find((x) => x.target === seen.target);
    await store.apply({ ...empty, promote: [{ id: f?.id ?? 0, seen }] }, T0);
    const id = f?.id ?? 0;
    const token = (await decisions.tokens([id])).get(id) ?? "";
    await store.setAction(id, state, "https://github.com/o/r/pull/3", "a".repeat(40));
    return [id, token];
  }

  it("only once the CI is green, with the right token; then it waits for the round", async () => {
    const [id, token] = await withPr("ci_verte");
    expect(await decisions.requestPr(id, "f".repeat(16), "merge", T0)).toBe("stale");
    expect(await decisions.requestPr(id, token, "merge", T0)).toBe("done");
    expect((await store.prRequests()).find((f) => f.id === id)?.actionState).toBe(
      "fusion_demandee",
    );
    expect(await decisions.requestPr(id, token, "close", T0)).toBe("not_ready");
    const [other, t2] = await withPr("pr_ouverte");
    expect(await decisions.requestPr(other, t2, "merge", T0)).toBe("not_ready");
  });

  it("a delegation takes only an open advisory with no action yet", async () => {
    const [id] = await withPr("pr_ouverte");
    expect(await store.delegateFix(id, T0)).toBe(false);
    const fresh = await openFinding();
    expect(await store.delegateFix(fresh, T0)).toBe(false);
  });

  it("the trust record counts the journaled outcomes of an action, nothing else", async () => {
    const action = `test_${run}`;
    for (const outcome of [
      "pr_opened",
      "pr_opened",
      "merged_clean",
      "closed",
      "ci_failed",
      "merged_edited",
    ]) {
      await sql`insert into events (agent, type, payload) values ('securite', 'securite.action', ${sql.json({ outcome, delegable: action })})`;
    }
    await sql`insert into events (agent, type, payload) values ('securite', 'securite.action', ${sql.json({ outcome: "merged_clean", delegable: "autre" })})`;
    expect(await store.actionCounts(action, new Date(0))).toEqual({
      prepared: 2,
      mergedClean: 1,
      mergedEdited: 1,
      closed: 1,
      ciFailed: 1,
    });
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
