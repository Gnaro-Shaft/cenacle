// The maintenance plan's buttons (J7d): read strictly — their own prefix, a
// plan number, a machine's place (never its name), a 16-hex token, nothing
// else; within Telegram's 64 bytes and 10 rows whatever the names; a machine
// I removed loses its buttons, a reboot button only where a reboot remains,
// and a machine keeps its place whatever I remove; the question says exactly
// what is left to run.
import { describe, expect, it } from "vitest";
import {
  confirmPlanKeyboard,
  PLAN_MAX_MACHINES,
  type PlanStepView,
  parsePlanPressed,
  planKeyboard,
  planMachines,
  planPrompt,
} from "./plan-buttons.ts";

// A fake token, built by pieces (a test value, not a secret).
const T = ["0123abcd", "ef456789"].join("");

describe("reading a tap", () => {
  it("the four buttons, and only them", () => {
    expect(parsePlanPressed(`m:v:7:${T}`)).toEqual({ kind: "valider", planId: 7, token: T });
    expect(parsePlanPressed(`m:c:7:${T}`)).toEqual({ kind: "confirmer", planId: 7, token: T });
    expect(parsePlanPressed(`m:r:7:2:${T}`)).toEqual({
      kind: "retirer_reboot",
      planId: 7,
      machine: 2,
      token: T,
    });
    expect(parsePlanPressed(`m:x:7:0:${T}`)).toEqual({
      kind: "retirer",
      planId: 7,
      machine: 0,
      token: T,
    });
  });

  it.each([
    undefined,
    "",
    `s:7:k:${T}`,
    `o:7:${T}`,
    `m:v:7:1:${T}`, // a machine on Valider
    `m:c:7:1:${T}`,
    `m:r:7:${T}`, // no machine on Retirer
    `m:x:7:${T}`,
    `m:v:0:${T}`, // plan 0
    `m:v:1234567890123:${T}`, // 13 digits
    `m:x:7:100:${T}`, // a place beyond 99
    `m:v:7:${T.toUpperCase()}`,
    `m:v:7:${T}0`,
    `m:v:7:${T.slice(1)}`,
    `m:v:7:${T}\n`,
    `m:v:-7:${T}`,
    `m:z:7:${T}`,
    `M:v:7:${T}`,
    `m:v:7:${T};drop`,
  ])("refuses %j", (data) => {
    expect(parsePlanPressed(data)).toBeNull();
  });
});

const step = (
  host: string,
  action: PlanStepView["action"],
  conditional = false,
  state?: string,
): PlanStepView => ({ host, action, conditional, ...(state === undefined ? {} : { state }) });

describe("the summary's buttons", () => {
  it("Valider first; per machine, its reboot (if any) and itself", () => {
    const steps = [
      step("vps-b", "maj_securite"),
      step("vps-b", "redemarrer", true),
      step("noeud-a", "services"),
    ];
    const rows = planKeyboard(7, T, planMachines(steps));
    expect(rows.map((r) => r.map((b) => b.text))).toEqual([
      ["✅ Valider le plan"],
      ["Retirer 🔄 de vps-b", "Retirer vps-b"],
      ["Retirer noeud-a"],
    ]);
    for (const b of rows.flat()) expect(parsePlanPressed(b.data)).not.toBeNull();
  });

  it("a removed machine loses its buttons; a removed reboot its own; places never move", () => {
    const steps = [
      step("vps-b", "services", false, "retiree"),
      step("noeud-a", "maj_securite", false, "attente"),
      step("noeud-a", "redemarrer", true, "retiree"),
      step("noeud-b", "services", false, "attente"),
    ];
    const machines = planMachines(steps);
    expect(machines.map((m) => [m.index, m.name, m.kept, m.reboot])).toEqual([
      [0, "vps-b", false, false],
      [1, "noeud-a", true, false],
      [2, "noeud-b", true, false],
    ]);
    expect(
      planKeyboard(7, T, machines)
        .flat()
        .map((b) => b.data),
    ).toEqual([`m:v:7:${T}`, `m:x:7:1:${T}`, `m:x:7:2:${T}`]);
  });

  it("long names, a long plan number, 20 machines: within 64 bytes and 10 rows", () => {
    const steps = Array.from({ length: 20 }, (_, i) =>
      step(`m${String(i).padStart(2, "0")}-${"x".repeat(36)}`, "redemarrer"),
    );
    const rows = planKeyboard(999_999_999_999, T, planMachines(steps));
    expect(rows.length).toBeLessThanOrEqual(1 + PLAN_MAX_MACHINES);
    for (const b of [...rows.flat(), ...confirmPlanKeyboard(999_999_999_999, T).flat()]) {
      expect(new TextEncoder().encode(b.data).length).toBeLessThanOrEqual(64);
    }
  });
});

describe("the question before my confirmation", () => {
  it("exactly what is left, in order, the 'if needed' said; nothing removed", () => {
    const text = planPrompt(7, [
      step("vps-b", "maj_securite", false, "attente"),
      step("vps-b", "services", true, "attente"),
      step("vps-b", "redemarrer", true, "retiree"),
      step("noeud-a", "services", false, "retiree"),
    ]);
    expect(text).toContain("• vps-b : ⬆, puis 🔁 s'il le faut");
    expect(text).not.toContain("🔄");
    expect(text).not.toContain("noeud-a");
    expect(text).toMatch(/^Confirmer le plan n°7 \?/);
    expect(text).toMatch(/Bouton valable 2 minutes\.$/);
  });
});
