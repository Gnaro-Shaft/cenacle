/**
 * `/demain` and `/agenda` (ADR-0042, P2): the hours of tomorrow or of the
 * week, asked of the page's server over its local socket. The bot holds no
 * password, and the answer it receives cannot hold a title — only hours,
 * counts, account names and failure words. Nothing is kept.
 */
import type { Ask, DayHours, FailureWord, HoursView } from "@cenacle/agenda/prise";
import { HoursError } from "@cenacle/agenda/prise";

export type AgendaAction = { readonly kind: "agenda"; readonly chatId: number; readonly ask: Ask };

export const USAGE = "Sans rien après : /demain pour demain, /agenda pour les 7 jours à venir.";

/** What "/demain" or "/agenda" asks for — nothing may follow the command. */
export function agendaAction(
  command: "/demain" | "/agenda",
  rest: string,
  chatId: number,
): AgendaAction | { readonly kind: "reply"; readonly chatId: number; readonly text: string } {
  if (rest !== "") return { kind: "reply", chatId, text: USAGE };
  return { kind: "agenda", chatId, ask: command === "/demain" ? "tomorrow" : "week" };
}

const FAILURE: Readonly<Record<FailureWord, string>> = {
  refus: "le serveur refuse le mot de passe",
  injoignable: "serveur injoignable",
  delai: "le serveur a mis trop de temps",
  illisible: "réponse illisible",
  hote: "une adresse hors des hôtes admis a été écartée",
  config: "mot de passe absent de .env.agenda",
};

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** "mer. 18/11" */
export function dayLabel(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "09:00, 14:30 et 3 autres (et 1 journée entière, 1 commencé la veille)" */
function dayText(day: DayHours): string {
  const timed = day.hours.length + day.more;
  const hours = day.hours.join(", ") + (day.more > 0 ? ` et ${day.more} autres` : "");
  const extras = [
    day.wholeDays > 0 ? plural(day.wholeDays, "journée entière", "journées entières") : "",
    day.ongoing > 0 ? plural(day.ongoing, "commencé la veille", "commencés la veille") : "",
  ].filter((x) => x !== "");
  if (timed === 0 && extras.length === 0) return "rien";
  if (timed === 0) return extras.join(", ");
  return extras.length === 0 ? hours : `${hours} (et ${extras.join(", ")})`;
}

/** The message for an answer. */
export function agendaText(ask: Ask, view: HoursView): string {
  if (view.read === "absent") return "📅 Aucun agenda déclaré (agenda.local.toml).";
  if (view.read === "config") {
    return "⚠ La configuration de l'agenda est fautive : la page dit pourquoi.";
  }
  const lines: string[] = [];
  if (ask === "tomorrow") {
    const day = view.days[0];
    if (day !== undefined) {
      const timed = day.hours.length + day.more;
      const head = `📅 Demain (${dayLabel(day.date)})`;
      lines.push(
        timed === 0
          ? `${head} : aucun rendez-vous à heure fixe${dayText(day) === "rien" ? "" : ` — ${dayText(day)}`}`
          : `${head} : ${plural(timed, "rendez-vous", "rendez-vous")} — ${dayText(day)}`,
      );
    }
  } else {
    lines.push("📅 Les 7 jours à venir :");
    for (const day of view.days) lines.push(`${dayLabel(day.date)} : ${dayText(day)}`);
  }
  for (const f of view.failures) lines.push(`⚠ ${f.account} : ${FAILURE[f.state]}`);
  if (view.failures.length > 0) lines.push("(les rendez-vous de ce compte ne sont pas comptés)");
  if (view.setAside > 0) {
    lines.push(
      `⚠ ${plural(view.setAside, "rendez-vous écarté", "rendez-vous écartés")} sur la période lue — la page dit pourquoi.`,
    );
  }
  return lines.join("\n");
}

const ERRORS: Readonly<Record<string, string>> = {
  unreachable: "🛑 Le serveur de la page ne répond pas : l'agenda ne peut pas être lu.",
  busy: "⏳ Une lecture de l'agenda est déjà en cours : réessaie dans un instant.",
  timeout: "⌛ L'agenda n'a pas répondu à temps : réessaie plus tard.",
};

export interface AgendaRelayDeps {
  readonly send: (text: string) => Promise<void>;
  readonly ask: (ask: Ask) => Promise<HoursView>;
}

/** Never throws: every outcome is one message, and a failed send costs nothing more. */
export async function relayAgenda(ask: Ask, deps: AgendaRelayDeps): Promise<void> {
  let text: string;
  try {
    text = agendaText(ask, await deps.ask(ask));
  } catch (error) {
    const code = error instanceof HoursError ? error.code : "";
    text = ERRORS[code] ?? "🛑 L'agenda n'a pas pu être lu.";
  }
  try {
    await deps.send(text);
  } catch {
    // Telegram unreachable: nothing more can be said through it.
  }
}
