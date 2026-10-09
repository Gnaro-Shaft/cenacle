/**
 * A question to the CTO from Telegram (ADR-0020, J2b — option (a) of 09/10):
 * acknowledged at once, asked over the CTO's socket, answered in messages of
 * at most 4000 characters. Plain text only (no Telegram formatting). Nothing
 * is kept; a failure is said in a short sentence, never with internal detail.
 * The rule is mine to hold: no third-party data in a question.
 */
import type { CtoProgress, CtoReply } from "@cenacle/cto/client";
import { CtoServiceError } from "@cenacle/cto/client";

/** Below Telegram's 4096, leaving room for a "(1/2)" marker. */
export const MAX_MESSAGE = 4000;
/** An answer is capped at 1500 tokens: a few messages, never a flood. */
export const MAX_MESSAGES = 5;

export const ACK =
  "🤔 Question transmise au CTO — réponse dans 1 à 3 min. (Rappel : jamais de nom de client ni de contenu de mail.)";

/**
 * Cuts a text into messages: at a paragraph break if it can, else a line
 * break, else a space, else hard — nothing lost, nothing over the limit.
 */
export function splitForTelegram(text: string, max = MAX_MESSAGE): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find(
      (i) => i > max / 2,
    );
    const cut = at ?? max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

const FAILURES: Record<string, string> = {
  busy: "⏳ Le CTO est occupé (trop de questions en attente) : repose-la dans quelques minutes.",
  unreachable: "🛑 Le service du CTO ne tourne pas (npm run service -- status cto).",
  model_unavailable: "🛑 Le modèle local ne répond pas : LM Studio est-il ouvert ?",
  timeout: "⌛ Le CTO n'a pas répondu à temps : repose ta question.",
  invalid: "Question refusée par le CTO : reformule-la (2000 caractères au plus).",
};

export interface RelayDeps {
  readonly send: (text: string) => Promise<void>;
  readonly ask: (question: string, onProgress?: (p: CtoProgress) => void) => Promise<CtoReply>;
}

/** Never throws: every outcome is a message, and a failed send costs nothing more. */
export async function relayToCto(question: string, deps: RelayDeps): Promise<void> {
  const send = async (text: string) => {
    try {
      await deps.send(text);
    } catch {
      // Telegram unreachable: nothing more can be said to me through it.
    }
  };
  await send(ACK);
  let reply: CtoReply;
  try {
    reply = await deps.ask(question);
  } catch (error) {
    const code = error instanceof CtoServiceError ? error.code : "";
    await send(FAILURES[code] ?? "🛑 Le CTO n'a pas pu répondre.");
    return;
  }
  const footer = [
    reply.cut
      ? "⚠ Réponse coupée à la limite de longueur : demande-lui d'approfondir un point."
      : "",
    reply.summary,
    `— ${reply.seconds} s, modèle local. Un avis à vérifier, pas un fait établi.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const parts = splitForTelegram(`${reply.text}\n\n${footer}`);
  const shown = parts.slice(0, MAX_MESSAGES);
  for (const [i, part] of shown.entries()) {
    await send(shown.length > 1 ? `(${i + 1}/${shown.length}) ${part}` : part);
  }
  if (parts.length > MAX_MESSAGES) {
    await send(
      "… réponse trop longue pour Telegram : pose-la depuis la page pour la lire en entier.",
    );
  }
}
