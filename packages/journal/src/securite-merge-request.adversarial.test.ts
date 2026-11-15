// My ✅ Fusionner, in the real database (ADR-0036, second step): signed in
// the same transaction that asks for the merge, over the row's address and
// commit — only if that commit is still the one my button showed. A button
// for a commit rewritten since, a field the bot cannot sign, or a failing
// signer asks for nothing. The signature lives only as long as the request,
// and the database refuses one that is not of its form.
import { randomBytes } from "node:crypto";
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  ConfirmationFieldError,
  confirmPrivateKeyFromEnv,
  confirmPublicKeyFromEnv,
  generateConfirmationKeys,
  type MergeConfirmation,
  signMergeConfirmation,
  verifyMergeConfirmation,
} from "@cenacle/core";
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
const keys = generateConfirmationKeys();
const priv = confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey });
const pub = confirmPublicKeyFromEnv({ [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey });
const T0 = new Date("2026-11-15T09:00:00.123Z");
const SHA = "e".repeat(40);
const URL = "https://github.com/exemple/cenacle/pull/41";
const run = randomBytes(4).toString("hex");
const empty = { insert: [], promote: [], touch: [], resolve: [], drop: [] };
let n = 0;

const signed: string[] = [];
const sign = (f: MergeConfirmation) => {
  const s = signMergeConfirmation(priv, f);
  signed.push(s);
  return s;
};
const merge = (shown = SHA.slice(0, 12), signer = sign) =>
  ({ action: "merge", shown, sign: signer }) as const;

async function greenPr(url = URL, sha = SHA): Promise<[number, string]> {
  n += 1;
  const seen: SeenFinding = {
    check: "npm_audit",
    type: "npm_advisory",
    target: `merge-${run}-${n}`,
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
  await store.setAction(id, "ci_verte", url, sha);
  return [id, token];
}
const read = async (id: number) => (await store.prRequests()).find((f) => f.id === id);
const state = async (id: number) =>
  (
    await sql<{ action_state: string; merge_sig: string | null }[]>`
    select action_state, merge_sig from securite_constats where id = ${id}`
  )[0];

describe("✅ Fusionner, signed with the commit my button showed", () => {
  it("signed over the row's own address and commit, at the instant of my tap", async () => {
    const [id, token] = await greenPr();
    expect(await decisions.requestPr(id, token, merge(), T0)).toBe("done");
    const f = await read(id);
    expect(f?.actionState).toBe("fusion_demandee");
    expect(f?.mergeConfirmedAt?.toISOString()).toBe(T0.toISOString());
    expect(f?.mergeSig).toBe(signed.at(-1));
    const fields = { findingId: id, prUrl: URL, headSha: SHA, confirmedAt: T0 };
    expect(verifyMergeConfirmation(pub, fields, f?.mergeSig ?? null)).toBe(true);
    // A double tap asks nothing more and signs nothing more.
    const before = signed.length;
    expect(await decisions.requestPr(id, token, merge(), T0)).toBe("not_ready");
    expect(signed.length).toBe(before);
  });

  it("the commit was rewritten after the buttons: nothing signed, nothing asked", async () => {
    const [id, token] = await greenPr();
    await sql`update securite_constats set action_head_sha = ${"f".repeat(40)} where id = ${id}`;
    const before = signed.length;
    expect(await decisions.requestPr(id, token, merge(), T0)).toBe("moved");
    expect(signed.length).toBe(before);
    expect(await state(id)).toEqual({ action_state: "ci_verte", merge_sig: null });
  });

  it("a button without the commit, or a short or odd one, asks nothing", async () => {
    const [id, token] = await greenPr();
    for (const shown of ["", SHA.slice(0, 7), SHA, "E".repeat(12), "e".repeat(11)]) {
      expect(await decisions.requestPr(id, token, merge(shown), T0)).toBe("moved");
    }
    expect((await state(id))?.action_state).toBe("ci_verte");
  });

  it("an address the database takes but the bot cannot sign: unsigned, nothing asked", async () => {
    for (const url of [
      "https://github.com/exemple/../pull/41",
      "https://github.com/ex_emple/cenacle/pull/41",
      "https://github.com/-exemple/cenacle/pull/41",
    ]) {
      const [id, token] = await greenPr(url);
      expect(await decisions.requestPr(id, token, merge(), T0)).toBe("unsigned");
      expect(await state(id)).toEqual({ action_state: "ci_verte", merge_sig: null });
    }
  });

  it("a signer that fails otherwise: the error surfaces, the row is untouched", async () => {
    const [id, token] = await greenPr();
    const broken = () => {
      throw new Error("disk on fire");
    };
    await expect(decisions.requestPr(id, token, merge(undefined, broken), T0)).rejects.toThrow(
      "disk on fire",
    );
    expect(await state(id)).toEqual({ action_state: "ci_verte", merge_sig: null });
    const fieldError = () => {
      throw new ConfirmationFieldError("cannot pin down");
    };
    expect(await decisions.requestPr(id, token, merge(undefined, fieldError), T0)).toBe("unsigned");
  });

  it("❌ Fermer signs nothing; the round's next step forgets any signature", async () => {
    const [id, token] = await greenPr();
    expect(await decisions.requestPr(id, token, { action: "close" }, T0)).toBe("done");
    expect(await state(id)).toEqual({ action_state: "fermeture_demandee", merge_sig: null });
    const [other, t2] = await greenPr();
    expect(await decisions.requestPr(other, t2, merge(), T0)).toBe("done");
    await store.setAction(other, "pr_ouverte");
    expect(await state(other)).toEqual({ action_state: "pr_ouverte", merge_sig: null });
    const [row] = await sql`select merge_confirmed_at from securite_constats where id = ${other}`;
    expect(row?.merge_confirmed_at).toBeNull();
  });

  it("the database refuses a signature that is not of its form", async () => {
    const [id] = await greenPr();
    for (const bad of ["x", "A".repeat(85), `${"A".repeat(85)}=`, `${"A".repeat(85)}\n`]) {
      await expect(
        sql`update securite_constats set merge_sig = ${bad} where id = ${id}`,
      ).rejects.toThrow(/merge_sig_form/);
    }
  });
});
