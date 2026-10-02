import { applyEvent, initialStatus, projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import type { TelegramUpdate } from "./api.ts";
import { describeStatus, handleUpdate } from "./handler.ts";

const OWNER = 111222333;
const msg = (text: string, chatId = OWNER, fromId = OWNER, type = "private"): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type }, from: { id: fromId }, text },
});
const deps = {
  allowedChatId: OWNER,
  readStatus: async () =>
    applyEvent(initialStatus("iris"), {
      id: 1n,
      occurredAt: new Date(0),
      agent: "iris",
      type: "proposal.created",
      payload: { proposalId: "p1" },
    }),
};

describe("handleUpdate", () => {
  it("answers /etat with the real status and the pending count", async () => {
    const [action] = await handleUpdate(msg("/etat"), deps);
    expect(action).toMatchObject({ kind: "reply", chatId: OWNER });
    expect(action?.kind === "reply" && action.text).toContain("au repos");
    expect(action?.kind === "reply" && action.text).toContain("1 validation");
  });

  it("accepts the command with the bot's name appended", async () => {
    const [action] = await handleUpdate(msg("/etat@cenacle_iris_bot"), deps);
    expect(action?.kind === "reply" && action.text).toContain("Iris");
  });

  it("journals /stop and confirms it", async () => {
    const actions = await handleUpdate(msg("/stop"), deps);
    expect(actions[0]).toEqual({ kind: "journal", type: "stop.requested" });
    expect(actions[1]).toMatchObject({ kind: "reply" });
  });

  it("explains itself on /aide and on unknown text", async () => {
    expect(await handleUpdate(msg("/aide"), deps)).toHaveLength(1);
    const [action] = await handleUpdate(msg("bonjour"), deps);
    expect(action?.kind === "reply" && action.text).toContain("/etat");
  });
});

describe("describeStatus — mail counters", () => {
  it("shows the last sort's counters, and only counters", () => {
    const status = projectStatus("iris", [
      {
        id: 1n,
        occurredAt: new Date(0),
        agent: "iris",
        type: "mail.fetched",
        payload: { count: 5 },
      },
      {
        id: 2n,
        occurredAt: new Date(0),
        agent: "iris",
        type: "mail.sorted_by_rules",
        payload: { clients_prospects: 2, administratif: 1, bruit: 1, a_trier: 0, remaining: 1 },
      },
    ]);
    const text = describeStatus(status);
    expect(text).toContain("📬 Courrier : clients 2 · admin 1 · bruit 1 · à trier 0 · 1 en cours");
  });

  it("says nothing about mail before the first pass", () => {
    expect(describeStatus(initialStatus("iris"))).not.toContain("📬");
  });
});
