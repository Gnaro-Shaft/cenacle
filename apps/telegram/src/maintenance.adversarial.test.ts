// /maintenance (J7c): the bot only records my ask — the operator, the only
// reader of serveurs.local.toml, answers within a minute. Off: said, nothing
// recorded. The database away: the reply says it was NOT recorded, never
// "asked". A stranger gets silence, as for every command.
import { describe, expect, it } from "vitest";
import { MAINTENANCE_NOT_RECORDED, perform } from "./actions.ts";
import type { TelegramUpdate } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 4242;
const update = (text: string, from = OWNER): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from }, text },
});

async function run(
  text: string,
  opts: { active?: boolean; record?: () => Promise<void>; from?: number },
) {
  const replies: string[] = [];
  const recorded: string[] = [];
  const logs: string[] = [];
  await perform(
    await handleUpdate(update(text, opts.from), {
      allowedChatId: OWNER,
      readStatus: async () => {
        throw new Error("unused");
      },
      maintenanceActive: () => opts.active ?? true,
    }),
    {
      reply: async (_, t) => {
        replies.push(t);
      },
      askCto: () => {},
      record: async (type) => {
        await (opts.record ?? (async () => {}))();
        recorded.push(type);
      },
      log: (l) => logs.push(l),
    },
  );
  return { replies, recorded, logs };
}

describe("/maintenance", () => {
  it("on: my ask recorded, then the promise of a minute", async () => {
    const r = await run("/maintenance", {});
    expect(r.recorded).toEqual(["maintenance.demande"]);
    expect(r.replies).toEqual([
      "🧰 Demandé : l'opérateur te l'envoie dans la minute (le Mac doit être allumé).",
    ]);
  });

  it("with the bot's name or trailing words: the same command", async () => {
    expect((await run("/maintenance@cenacle_iris_bot", {})).recorded).toEqual([
      "maintenance.demande",
    ]);
    expect((await run("  /Maintenance  maintenant", {})).recorded).toEqual(["maintenance.demande"]);
  });

  it("off: said, nothing recorded", async () => {
    const r = await run("/maintenance", { active: false });
    expect(r.recorded).toEqual([]);
    expect(r.replies[0]).toContain("[maintenance] actif");
  });

  it("the database away: NOT recorded, said so, never 'Demandé'", async () => {
    const r = await run("/maintenance", {
      record: async () => {
        throw new Error("connect ECONNREFUSED db.internal.example:5432");
      },
    });
    expect(r.replies).toEqual([MAINTENANCE_NOT_RECORDED]);
    expect(r.replies.join()).not.toMatch(/Demandé|db\.internal/);
    expect(r.logs).toEqual(["⚠ /maintenance reçu mais non enregistré : base injoignable"]);
  });

  it("a stranger: silence, and the ask is not recorded as mine", async () => {
    const r = await run("/maintenance", { from: 777 });
    expect(r.replies).toEqual([]);
    expect(r.recorded).toEqual(["telegram.rejected"]);
  });

  it("listed in the help and in the fallback", async () => {
    expect((await run("/aide", {})).replies[0]).toContain("/maintenance");
    expect((await run("/nimporte", {})).replies[0]).toContain("/maintenance");
  });
});
