// The maintenance plan's taps, through the bot (J7d): only I am heard;
// both switches are read at each tap; "Valider" asks with exactly what will
// run and a confirmation button of its own; "Retirer" takes out the machine
// at that place in the plan — never one named by the button — and redraws
// the buttons; "Confirmer" works within its 2 minutes, once, never beside a
// running plan, and takes the buttons away; a stale tap changes nothing. The
// bot never runs anything — the operator does.
import type { PlanConfirmOutcome, PlanStep, StoredPlan } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import type { TelegramCallback } from "./api.ts";
import { handleCallback, type SecuriteBotDeps } from "./securite-bot.ts";

const OWNER = 4242;
// Fake tokens, built by pieces (test values, not secrets).
const BTN = ["01234567", "89abcdef"].join("");
const CONF = ["fedcba98", "76543210"].join("");
const NOW = new Date("2026-10-27T08:10:00Z");
const STALE = "answer Ce bouton n'est plus valable (plan remplacé ou déjà traité).";

type Step = { -readonly [K in keyof PlanStep]: PlanStep[K] };

function world(
  opts: { maintenance?: boolean; servers?: boolean; confirm?: PlanConfirmOutcome } = {},
) {
  const calls: string[] = [];
  const steps: Step[] = (
    [
      ["vps-b", "maj_securite"],
      ["vps-b", "redemarrer"],
      ["noeud-a", "services"],
    ] as const
  ).map(([host, action], i) => ({
    id: 10 + i,
    position: i,
    host,
    action,
    conditional: action === "redemarrer",
    state: "attente",
    actionId: null,
    reason: null,
  }));
  const plan = { id: 7, state: "proposee" as StoredPlan["state"], messageId: 900 };
  const removed: string[] = [];
  const deps: SecuriteBotDeps = {
    allowedChatId: OWNER,
    api: {
      sendMessage: async () => {},
      sendWithButtons: async (_c, text, rows) => {
        const data = rows
          .flat()
          .map((b) => b.callback_data)
          .join(",");
        calls.push(`buttons ${text.split("\n")[0]} | ${data}`);
        return 950;
      },
      askReply: async () => 1,
      answerCallback: async (_id, text) => {
        calls.push(`answer ${text}`);
      },
      editButtons: async (_c, messageId, rows) => {
        const data = rows
          .flat()
          .map((b) => b.callback_data)
          .join(",");
        calls.push(`edit ${messageId} ${data}`);
      },
    },
    store: { open: async () => [] },
    decisions: {} as SecuriteBotDeps["decisions"],
    serverActions: {} as SecuriteBotDeps["serverActions"],
    serversActive: () => opts.servers ?? true,
    maintenanceActive: () => opts.maintenance ?? true,
    plans: {
      get: async (id) =>
        id === plan.id
          ? {
              ...plan,
              createdAt: NOW,
              confirmedAt: null,
              steps: steps.map((s) => ({ ...s })),
            }
          : null,
      remove: async (id, token, host, action) => {
        if (id !== plan.id || token !== BTN || plan.state !== "proposee") return false;
        const hit = steps.filter(
          (s) =>
            s.host === host && s.state === "attente" && (action === null || s.action === action),
        );
        for (const s of hit) s.state = "retiree";
        removed.push(`${host}:${action ?? "*"}`);
        return hit.length > 0;
      },
      ask: async (id, token) =>
        id === plan.id && token === BTN && steps.some((s) => s.state === "attente") ? CONF : null,
      confirm: async (id, token) => {
        if (id !== plan.id || token !== CONF) return "stale";
        const outcome = opts.confirm ?? "done";
        if (outcome === "done") plan.state = "confirmee";
        return outcome;
      },
    },
    journal: {
      append: async (e) => {
        calls.push(`journal ${e.type} ${JSON.stringify(e.payload)}`);
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
  };
  return { deps, calls, steps, plan, removed };
}

const tap = (data: string, from = OWNER, messageId = 900): TelegramCallback => ({
  id: "cb",
  from: { id: from },
  message: { message_id: messageId, chat: { id: from, type: "private" } },
  data,
});

describe("only I am heard; the switches are read at each tap", () => {
  it("a stranger's tap: nothing decided, journaled without who", async () => {
    const w = world();
    await handleCallback(tap(`m:v:7:${BTN}`, 777), w.deps);
    expect(w.calls).toEqual([`journal telegram.rejected {"reason":"not_the_owner"}`]);
  });

  it.each([
    ["the maintenance switch", { maintenance: false }],
    ["the servers' switch", { servers: false }],
  ])("%s off: said, nothing decided", async (_, opts) => {
    const w = world(opts);
    await handleCallback(tap(`m:x:7:0:${BTN}`), w.deps);
    expect(w.removed).toEqual([]);
    expect(w.calls).toEqual([
      "answer Le plan de maintenance ou les actions sur les serveurs sont coupés (securite.toml).",
    ]);
  });
});

describe("Valider", () => {
  it("asks with exactly what is left and a confirmation button of its own", async () => {
    const w = world();
    await handleCallback(tap(`m:v:7:${BTN}`), w.deps);
    expect(w.calls).toEqual([
      `journal maintenance.plan {"quoi":"valide"}`,
      `buttons Confirmer le plan n°7 ? Dans cet ordre, une étape à la fois, chacune revérifiée et prouvée : | m:c:7:${CONF}`,
      "answer Plan à confirmer : le bouton est sous ma question, valable 2 minutes.",
    ]);
  });

  it("a stale token: nothing asked", async () => {
    const w = world();
    await handleCallback(tap(`m:v:7:${CONF}`), w.deps);
    expect(w.calls).toEqual([STALE]);
  });

  it("every step removed: nothing to validate", async () => {
    const w = world();
    for (const s of w.steps) s.state = "retiree";
    await handleCallback(tap(`m:v:7:${BTN}`), w.deps);
    expect(w.calls).toEqual(["answer Plus rien dans ce plan : il n'y a rien à valider."]);
  });
});

describe("Retirer", () => {
  it("the reboot of the machine at that place; the buttons redrawn without it", async () => {
    const w = world();
    await handleCallback(tap(`m:r:7:0:${BTN}`), w.deps);
    expect(w.removed).toEqual(["vps-b:redemarrer"]);
    expect(w.calls).toEqual([
      `journal maintenance.plan {"quoi":"retire_redemarrage"}`,
      "answer 🔄 retiré de vps-b.",
      `edit 900 m:v:7:${BTN},m:x:7:0:${BTN},m:x:7:1:${BTN}`,
    ]);
  });

  it("a whole machine; it disappears from the buttons", async () => {
    const w = world();
    await handleCallback(tap(`m:x:7:1:${BTN}`), w.deps);
    expect(w.removed).toEqual(["noeud-a:*"]);
    expect(w.calls.at(-1)).toBe(`edit 900 m:v:7:${BTN},m:r:7:0:${BTN},m:x:7:0:${BTN}`);
  });

  it("a place beyond the plan's machines, or a wrong token: nothing removed", async () => {
    const w = world();
    await handleCallback(tap(`m:x:7:5:${BTN}`), w.deps);
    await handleCallback(tap(`m:x:7:0:${CONF}`), w.deps);
    expect(w.steps.every((s) => s.state === "attente")).toBe(true);
    expect(w.calls.filter((c) => c.startsWith("answer"))).toEqual([STALE, STALE]);
  });

  it("an edit that fails loses only the edit", async () => {
    const w = world();
    const deps: SecuriteBotDeps = {
      ...w.deps,
      api: {
        ...w.deps.api,
        editButtons: async () => {
          throw new Error("Telegram");
        },
      },
    };
    await expect(handleCallback(tap(`m:r:7:0:${BTN}`), deps)).resolves.toBeUndefined();
    expect(w.removed).toEqual(["vps-b:redemarrer"]);
  });
});

describe("Confirmer", () => {
  it("done: said, journaled, the question's and the summary's buttons taken away", async () => {
    const w = world();
    await handleCallback(tap(`m:c:7:${CONF}`, OWNER, 950), w.deps);
    expect(w.calls).toEqual([
      `journal maintenance.plan {"quoi":"confirme"}`,
      "answer Plan confirmé : l'opérateur commence dans la minute (le Mac doit rester allumé).",
      "edit 950 ",
      "edit 900 ",
    ]);
  });

  it.each([
    ["expired", "Délai de 2 minutes dépassé : rappuie sur ✅ Valider le plan.", ["edit 950 "]],
    ["busy", "Un plan tourne déjà : celui-ci attendra le prochain récapitulatif.", []],
    ["already", "Ce plan est déjà confirmé.", []],
  ] as Array<[PlanConfirmOutcome, string, string[]]>)(
    "%s: said, nothing journaled",
    async (outcome, said, edits) => {
      const w = world({ confirm: outcome });
      await handleCallback(tap(`m:c:7:${CONF}`, OWNER, 950), w.deps);
      expect(w.calls).toEqual([`answer ${said}`, ...edits]);
    },
  );

  it("the button's token instead of the confirmation's: stale", async () => {
    const w = world();
    await handleCallback(tap(`m:c:7:${BTN}`, OWNER, 950), w.deps);
    expect(w.calls).toEqual([STALE]);
    expect(w.plan.state).toBe("proposee");
  });
});

describe("a bot without the plans wired", () => {
  it("a plan's tap is stale, never thrown", async () => {
    const w = world();
    const { plans: _p, maintenanceActive: _m, ...rest } = w.deps;
    await handleCallback(tap(`m:v:7:${BTN}`), rest);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toMatch(/^answer Ce bouton n'est plus valable/);
  });
});
