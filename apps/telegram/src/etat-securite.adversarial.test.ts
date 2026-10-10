// Watching the watcher (J6, Legion's santé): /etat says when the security
// agent last made its round; three missed rounds are flagged; a round never
// made, or a journal that cannot be read, is said — and never hides Iris's
// own status.
import { projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import type { TelegramUpdate } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 4242;
const NOW = new Date("2026-10-11T10:00:00Z");
const etat: TelegramUpdate = {
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: OWNER, type: "private" },
    from: { id: OWNER },
    text: "/etat",
  },
};
const text = async (lastSecurityRound?: () => Promise<Date | null>) => {
  const [action] = await handleUpdate(etat, {
    allowedChatId: OWNER,
    readStatus: async (agent) => projectStatus(agent, []),
    now: () => NOW,
    ...(lastSecurityRound === undefined ? {} : { lastSecurityRound }),
  });
  return action?.kind === "reply" ? action.text : "";
};
const ago = (min: number) => async () => new Date(NOW.getTime() - min * 60_000);

describe("/etat and the security agent's round", () => {
  it("a recent round: its age, nothing more", async () => {
    expect(await text(ago(12))).toMatch(/🛡 Sécurité : dernière ronde il y a 12 min$/);
  });

  it("three missed rounds (45 min): flagged", async () => {
    expect(await text(ago(50))).toMatch(
      /il y a 50 min ⚠ \(Mac endormi, ou l'agent ne tourne plus\)/,
    );
    expect(await text(ago(44))).not.toMatch(/⚠/);
  });

  it("never made, or unreadable: said, and Iris's status still shown first", async () => {
    expect(await text(async () => null)).toMatch(/aucune ronde encore/);
    const broken = await text(async () => {
      throw new Error("connect ECONNREFUSED db.internal:5432");
    });
    expect(broken).toMatch(/dernière ronde illisible/);
    expect(broken).not.toMatch(/ECONNREFUSED|db\.internal/);
    expect(broken.split("\n")[0]).not.toMatch(/Sécurité/);
  });

  it("without the agent wired: no line at all", async () => {
    expect(await text()).not.toMatch(/Sécurité/);
  });
});
