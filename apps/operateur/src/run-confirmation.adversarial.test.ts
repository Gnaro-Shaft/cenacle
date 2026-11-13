// My confirmation holds 15 minutes (ADR-0027, revised 2026-11-13): the Mac
// asleep or the operator stopped, a confirmed action does not run hours later
// on a verdict that happens to show the problem again. Too old, missing or
// from the future, the confirmation is void: refused before any call, said by
// its name — and a plan's step refused this way stops the plan.
import { CONFIRMED_VALID_MINUTES } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { outcomeOf } from "./plan.ts";
import { runOperator } from "./run.ts";
import { MIN, NOW, type Row, world } from "./test-world.ts";

const confirmedAt = (w: ReturnType<typeof world>, at: Date | null) => {
  (w.rows[0] as Row).confirmedAt = at;
};

describe("a confirmation is for now", () => {
  it("15 minutes old, to the millisecond: it still acts", async () => {
    const w = world();
    confirmedAt(w, new Date(NOW.getTime() - CONFIRMED_VALID_MINUTES * MIN));
    expect(await runOperator(w.deps)).toMatchObject({ ran: 1, refused: 0 });
    expect(w.rows[0]).toMatchObject({ state: "faite" });
  });

  it.each([
    [
      "one millisecond past 15 minutes",
      new Date(NOW.getTime() - CONFIRMED_VALID_MINUTES * MIN - 1),
    ],
    ["this morning, the Mac asleep since", new Date(NOW.getTime() - 9 * 60 * MIN)],
    ["three days ago", new Date(NOW.getTime() - 3 * 24 * 60 * MIN)],
    ["never: a confirmed row without its instant", null],
    ["from the future, beyond the clock's margin", new Date(NOW.getTime() + 5 * MIN + 1)],
    ["an instant that is no instant", new Date(Number.NaN)],
  ])("%s: refused, nothing run, said by its name", async (_label, at) => {
    const w = world();
    confirmedAt(w, at);
    expect(await runOperator(w.deps)).toMatchObject({ ran: 0, refused: 1 });
    expect(w.calls).toEqual([]);
    expect(w.rows[0]).toMatchObject({ state: "refusee", refusal: "confirmation_perimee" });
    expect(w.sent[0]).toMatch(
      /^🛑 vps-b .* rien n'a été fait — ta confirmation a plus de 15 minutes/,
    );
    expect(w.events).toEqual([
      { action: "services", outcome: "refusee", refusal: "confirmation_perimee" },
    ]);
  });

  it("a reboot confirmed hours ago does not go, even with a fresh verdict asking for it", async () => {
    const w = world();
    Object.assign(w.rows[0] as Row, {
      action: "redemarrer",
      confirmedAt: new Date(NOW.getTime() - 6 * 60 * MIN),
    });
    w.seen([
      {
        type: "serveur_redemarrage",
        target: "vps-b",
        occurrence: "-",
        severity: "moyen",
        title: "x",
      },
    ]);
    expect(await runOperator(w.deps)).toMatchObject({ ran: 0, refused: 1 });
    expect(w.calls).toEqual([]);
    expect(w.rows[0]).toMatchObject({ refusal: "confirmation_perimee" });
  });

  it("within the clock's margin ahead (5 minutes): it acts", async () => {
    const w = world();
    confirmedAt(w, new Date(NOW.getTime() + 5 * MIN));
    expect(await runOperator(w.deps)).toMatchObject({ ran: 1, refused: 0 });
  });

  it("the switch off is said first: the confirmation's age is not what stopped it", async () => {
    const w = world({ active: false });
    confirmedAt(w, new Date(NOW.getTime() - 60 * MIN));
    await runOperator(w.deps);
    expect(w.rows[0]).toMatchObject({ refusal: "interrupteur" });
  });

  it("a plan's step refused this way stops the plan: a hitch, never a skip", async () => {
    const w = world();
    confirmedAt(w, new Date(NOW.getTime() - 60 * MIN));
    await runOperator(w.deps);
    expect(outcomeOf(w.rows[0] as Row)).toEqual({
      kind: "stop",
      reason: "refus_confirmation_perimee",
    });
  });
});
