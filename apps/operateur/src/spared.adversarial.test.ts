// The proof of a restart knows the spared ones (ADR-0035, point 7): the
// script folds what it left by principle into its exit code (20 + n,
// 120 + n). A later verdict counting no more than n says "only the spared
// ones remain" — the site's VPS on 2026-10-26: 3 before, 5 after, all spared,
// told "still there". One more than n is still there; a code of another
// action, or out of range, never reads as a count.
import type { Observation } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { runOperator } from "./run.ts";
import { MIN, NOW, type Row, world } from "./test-world.ts";

const services = (n: number): Observation[] => [
  {
    type: "serveur_services",
    target: "vps-b",
    occurrence: "-",
    severity: "moyen",
    title: "x",
    params: { count: String(n) },
  },
];

/** One restart answered by `code`, then a verdict counting `after`. */
async function restart(code: number, before: number, after: number) {
  const w = world({ ssh: async () => code });
  w.seen(services(before));
  await runOperator(w.deps);
  (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - MIN);
  w.verdictAt(NOW.getTime());
  w.seen(services(after));
  await runOperator(w.deps);
  return w;
}

describe("the spared count in the proof", () => {
  it("the site's VPS: 3 before, 5 after, 5 spared — only the spared ones remain", async () => {
    const w = await restart(25, 3, 5);
    expect(w.rows[0]).toMatchObject({
      state: "faite",
      exitCode: 25,
      verified: "epargnes",
      afterCount: 5,
    });
    expect(w.sent[0]).toMatch(/fait \(5 épargné\(s\) par principe/);
    expect(w.sent.at(-1)).toMatch(
      /^✅ vps-b \(constat n°40\) : relances faites ; il ne reste que 5 /,
    );
  });

  it("fewer and within the spared: 'epargnes' wins over 'reduit'", async () => {
    const w = await restart(28, 26, 8);
    expect(w.rows[0]?.verified).toBe("epargnes");
  });

  it("one more than the spared: still there, never 'epargnes'", async () => {
    const w = await restart(25, 3, 6);
    expect(w.rows[0]?.verified).toBe("toujours_la");
    expect(w.sent.at(-1)).toMatch(/^⚠ vps-b/);
  });

  it("fewer, but more than the spared: 'reduit', as before", async () => {
    const w = await restart(22, 26, 8);
    expect(w.rows[0]?.verified).toBe("reduit");
  });

  it("no spared count (0): the older proof, unchanged", async () => {
    const w = await restart(0, 3, 5);
    expect(w.rows[0]?.verified).toBe("toujours_la");
    expect(w.sent[0]).not.toMatch(/épargné/);
  });

  it("gone from the verdict: gone, whatever was spared", async () => {
    const w = await restart(25, 3, 0);
    w.seen([]);
    (w.rows[0] as Row).verified = null;
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("disparu");
  });
});

describe("the spared count when nothing was restarted", () => {
  it("125: nothing to restart, 5 spared — said, no proof awaited", async () => {
    const w = world({ ssh: async () => 125 });
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "rien_a_faire", exitCode: 125, verified: null });
    expect(w.sent[0]).toMatch(/^🔁 vps-b \(constat n°40\) : rien à relancer — il ne reste que 5 /);
  });

  it("the bases and out of range: a failure, never a count", async () => {
    for (const code of [20, 120, 220, 254]) {
      const w = world({ ssh: async () => code });
      await runOperator(w.deps);
      expect(w.rows[0]).toMatchObject({ state: "echouee", exitCode: code });
      expect(w.sent[0]).not.toMatch(/épargné/);
    }
  });

  it("a reboot answering 21: a failure — only cenacle-services counts", async () => {
    const w = world({ ssh: async () => 21 });
    (w.rows[0] as Row).action = "redemarrer";
    w.seen([
      {
        type: "serveur_redemarrage",
        target: "vps-b",
        occurrence: "-",
        severity: "moyen",
        title: "x",
      },
    ]);
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ state: "echouee", exitCode: 21 });
  });
});
