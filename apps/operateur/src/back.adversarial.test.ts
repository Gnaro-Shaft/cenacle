// "Back" read right (2026-10-26): Legion says MALADE of a machine it reached
// and judged badly — a full disk, an unexpected port, a cluster without
// quorum — as well as of one it could not read. A node at 91 % of disk,
// rebooted and back, must be said back; one whose ssh fails must not.
import type { Observation } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { runOperator } from "./run.ts";
import { MIN, NOW, type Row, world } from "./test-world.ts";

const obs = (type: string, occurrence = "-"): Observation => ({
  type,
  target: "vps-b",
  occurrence,
  severity: "moyen",
  title: "x",
});

async function rebootedTenMinutesAgo() {
  const w = world();
  (w.rows[0] as Row).action = "redemarrer";
  w.seen([obs("serveur_redemarrage")]);
  await runOperator(w.deps);
  (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - 10 * MIN);
  w.verdictAt(NOW.getTime() - MIN);
  w.hostEtat("MALADE");
  return w;
}

describe("a reboot's proof, when the machine is MALADE", () => {
  it.each([
    ["a full disk", [obs("serveur_disque", "/")]],
    ["an unexpected port", [obs("serveur_port", "tcp/9999")]],
    ["a cluster without quorum", [obs("serveur_quorum")]],
  ])("for %s: Legion read it — back, said back", async (_, seen) => {
    const w = await rebootedTenMinutesAgo();
    w.seen(seen);
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("disparu");
    expect(w.sent.at(-1)).toMatch(/est revenue/);
  });

  it("for anything else (ssh failed, no bulletin): not back — the loud alert at 30 minutes", async () => {
    const w = await rebootedTenMinutesAgo();
    w.seen([obs("serveur_autre")]);
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBeNull();
    (w.rows[0] as Row).finishedAt = new Date(NOW.getTime() - 31 * MIN);
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("pas_revenue");
  });

  it("MALADE with nothing said at all: not back", async () => {
    const w = await rebootedTenMinutesAgo();
    w.seen([]);
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBeNull();
  });

  it("a full disk, but the reboot still required: back, and said to look at", async () => {
    const w = await rebootedTenMinutesAgo();
    w.seen([obs("serveur_disque", "/"), obs("serveur_redemarrage")]);
    await runOperator(w.deps);
    expect(w.rows[0]?.verified).toBe("toujours_la");
  });
});
