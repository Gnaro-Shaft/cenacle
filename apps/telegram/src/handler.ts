/**
 * Decides what to do with one Telegram update. Pure: it returns actions,
 * main.ts performs them — which makes every rule testable.
 *
 * Only the owner, in a private chat, is answered. Anyone else gets silence
 * (the bot does not reveal itself), and the attempt is journaled without
 * keeping who it was (data minimisation).
 */
import type { AgentStatus, VisualState } from "@cenacle/core";
import type { TelegramUpdate } from "./api.ts";

export type Action =
  | { readonly kind: "reply"; readonly chatId: number; readonly text: string }
  | { readonly kind: "journal"; readonly type: "telegram.rejected"; readonly reason: string }
  | { readonly kind: "journal"; readonly type: "stop.requested" };

export interface HandlerDeps {
  readonly allowedChatId: number;
  readonly readStatus: (agent: string) => Promise<AgentStatus>;
}

const LABELS: Record<VisualState, string> = {
  resting: "😌 au repos",
  working: "⚙️ en activité",
  sick: "🤒 malade",
};

const HELP = [
  "Je suis Iris, du Cénacle. Commandes :",
  "/etat — où j'en suis",
  "/stop — arrêt d'urgence (noté dans le journal)",
  "/aide — cette aide",
].join("\n");

export function describeStatus(status: AgentStatus): string {
  const lines = [`Iris : ${LABELS[status.view.visual]}`];
  if (status.view.note === "waiting_for_mac") lines.push("En attente du Mac.");
  lines.push(
    status.pendingApprovals === 0
      ? "Rien à valider."
      : `💬 ${status.pendingApprovals} validation(s) en attente — à lire sur la page.`,
  );
  if (status.mail !== null) {
    // Counters only: no mail content ever goes to Telegram.
    const m = status.mail;
    lines.push(
      `📬 Courrier : clients ${m.clients_prospects} · admin ${m.administratif} · bruit ${m.bruit} · à trier ${m.a_trier}${m.pending > 0 ? ` · ${m.pending} en cours` : ""}`,
    );
    if (m.due > 0 || m.waiting > 0) {
      lines.push(`🔔 ${m.due} à relancer · ⏳ ${m.waiting} en attente de réponse`);
    }
  }
  return lines.join("\n");
}

/** "/etat@cenacle_iris_bot extra" → "/etat" */
function commandOf(text: string): string {
  const first = text.trim().split(/\s+/, 1)[0] ?? "";
  return first.split("@", 1)[0]?.toLowerCase() ?? "";
}

export async function handleUpdate(update: TelegramUpdate, deps: HandlerDeps): Promise<Action[]> {
  const message = update.message;
  if (message === undefined) return [];

  const isOwner =
    message.chat.type === "private" &&
    message.chat.id === deps.allowedChatId &&
    message.from?.id === deps.allowedChatId;
  if (!isOwner) {
    return [{ kind: "journal", type: "telegram.rejected", reason: "not_the_owner" }];
  }

  const reply = (text: string): Action => ({ kind: "reply", chatId: message.chat.id, text });
  switch (commandOf(message.text ?? "")) {
    case "/etat":
      try {
        return [reply(describeStatus(await deps.readStatus("iris")))];
      } catch (error) {
        return [reply(`🤒 Je ne peux pas calculer mon état : ${(error as Error).message}`)];
      }
    case "/stop":
      return [
        { kind: "journal", type: "stop.requested" },
        reply("🛑 Arrêt demandé — c'est noté dans le journal."),
      ];
    case "/start":
    case "/aide":
    case "/help":
      return [reply(HELP)];
    default:
      return [reply("Je ne comprends que /etat, /stop et /aide.")];
  }
}
