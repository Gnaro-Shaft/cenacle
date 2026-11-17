// `/demain` and `/agenda` (ADR-0042, P2): only the owner is answered; nothing
// may follow the command; the message says hours and counts, names a failing
// account with its word, and never says what the socket could not give; every
// failure is one short sentence, a failed send costs nothing; the request runs
// apart, so the bot keeps answering; and the bot imports of the agenda its
// socket client alone (a test reads the code).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HoursError, type HoursView } from "@cenacle/agenda/prise";
import { describe, expect, it } from "vitest";
import { AGENDA_NOT_WIRED, perform } from "./actions.ts";
import { agendaText, dayLabel, relayAgenda, USAGE } from "./agenda-bot.ts";
import type { TelegramUpdate } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 42;
const update = (text: string, from = OWNER): TelegramUpdate =>
  ({
    update_id: 1,
    message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from }, text },
  }) as TelegramUpdate;
const deps = { allowedChatId: OWNER, readStatus: async () => ({}) as never };

const day = (date: string, over: object = {}) => ({
  date,
  hours: [] as string[],
  more: 0,
  wholeDays: 0,
  ongoing: 0,
  ...over,
});
const ok = (days: ReturnType<typeof day>[], over: object = {}): HoursView =>
  ({ read: "ok", days, failures: [], setAside: 0, ...over }) as HoursView;

describe("the commands", () => {
  it("/demain and /agenda ask for tomorrow and the week; the bot's name may follow", async () => {
    expect(await handleUpdate(update("/demain"), deps)).toEqual([
      { kind: "agenda", chatId: OWNER, ask: "tomorrow" },
    ]);
    expect(await handleUpdate(update("/agenda@cenacle_iris_bot"), deps)).toEqual([
      { kind: "agenda", chatId: OWNER, ask: "week" },
    ]);
  });

  it("nothing may follow: no window, no account chosen from Telegram", async () => {
    for (const text of ["/demain 31", "/agenda pro", "/agenda 2026-12-01"]) {
      expect(await handleUpdate(update(text), deps)).toEqual([
        { kind: "reply", chatId: OWNER, text: USAGE },
      ]);
    }
  });

  it("a stranger is not answered", async () => {
    expect(await handleUpdate(update("/demain", 7), deps)).toEqual([
      { kind: "journal", type: "telegram.rejected", reason: "not_the_owner" },
    ]);
  });

  it("the help names them", async () => {
    const [help] = await handleUpdate(update("/aide"), deps);
    expect(help?.kind === "reply" && help.text).toContain("/demain");
    expect(help?.kind === "reply" && help.text).toContain("jamais d'intitulé");
  });
});

describe("the message", () => {
  it("tomorrow: the count, the hours, the whole days and those begun the day before", () => {
    const view = ok([day("2026-11-18", { hours: ["09:00", "14:30", "17:00"], wholeDays: 1 })]);
    expect(agendaText("tomorrow", view)).toBe(
      "📅 Demain (mer. 18/11) : 3 rendez-vous — 09:00, 14:30, 17:00 (et 1 journée entière)",
    );
    const busy = ok([day("2026-11-18", { hours: ["08:00"], more: 60, ongoing: 2 })]);
    expect(agendaText("tomorrow", busy)).toBe(
      "📅 Demain (mer. 18/11) : 61 rendez-vous — 08:00 et 60 autres (et 2 commencés la veille)",
    );
  });

  it("tomorrow empty, or with whole days only", () => {
    expect(agendaText("tomorrow", ok([day("2026-11-18")]))).toBe(
      "📅 Demain (mer. 18/11) : aucun rendez-vous à heure fixe",
    );
    expect(agendaText("tomorrow", ok([day("2026-11-18", { wholeDays: 2 })]))).toBe(
      "📅 Demain (mer. 18/11) : aucun rendez-vous à heure fixe — 2 journées entières",
    );
  });

  it("the week: one line per day, an empty day says so", () => {
    const days = ["2026-11-17", "2026-11-18", "2026-11-19"].map((d) => day(d));
    days[1] = day("2026-11-18", { hours: ["10:00"] });
    expect(agendaText("week", ok(days)).split("\n")).toEqual([
      "📅 Les 7 jours à venir :",
      "mar. 17/11 : rien",
      "mer. 18/11 : 10:00",
      "jeu. 19/11 : rien",
    ]);
  });

  it("a failing account is named with its word; set-aside events send to the page", () => {
    const text = agendaText(
      "tomorrow",
      ok([day("2026-11-18")], {
        failures: [{ account: "pro", state: "refus" }],
        setAside: 2,
      }),
    );
    expect(text).toContain("⚠ pro : le serveur refuse le mot de passe");
    expect(text).toContain("ne sont pas comptés");
    expect(text).toContain("⚠ 2 rendez-vous écartés sur la période lue — la page dit pourquoi.");
  });

  it("no agenda, a faulty configuration", () => {
    expect(agendaText("week", { read: "absent" })).toContain("Aucun agenda déclaré");
    expect(agendaText("week", { read: "config" })).toContain("la page dit pourquoi");
  });

  it("the weekday is the date's own, whatever the machine's zone", () => {
    expect(dayLabel("2026-03-29")).toBe("dim. 29/03");
    expect(dayLabel("2026-10-25")).toBe("dim. 25/10");
    expect(dayLabel("2027-01-01")).toBe("ven. 01/01");
  });
});

describe("the relay", () => {
  const run = async (ask: () => Promise<HoursView>, failSend = false) => {
    const sent: string[] = [];
    await relayAgenda("week", {
      ask,
      send: async (t) => {
        if (failSend) throw new Error("telegram down");
        sent.push(t);
      },
    });
    return sent;
  };

  it("each failure is one short sentence, never the error's text", async () => {
    for (const [code, words] of [
      ["unreachable", "ne répond pas"],
      ["busy", "déjà en cours"],
      ["timeout", "à temps"],
      ["broken", "n'a pas pu être lu"],
      ["internal", "n'a pas pu être lu"],
    ] as const) {
      const sent = await run(async () => {
        throw new HoursError(code);
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain(words);
    }
    const sent = await run(async () => {
      throw new Error("RDV M. Untel at 10:00");
    });
    expect(sent).toEqual(["🛑 L'agenda n'a pas pu être lu."]);
  });

  it("a failed send never throws", async () => {
    await expect(run(async () => ({ read: "absent" }), true)).resolves.toEqual([]);
  });

  it("is performed apart: the bot does not wait for the reading", async () => {
    const asked: string[] = [];
    let replied = 0;
    await perform([{ kind: "agenda", chatId: OWNER, ask: "week" }], {
      reply: async () => {
        replied++;
      },
      askCto: () => {},
      agenda: (_chat, ask) => asked.push(ask),
      record: async () => {},
      log: () => {},
    });
    expect(asked).toEqual(["week"]);
    expect(replied).toBe(0);
    const said: string[] = [];
    await perform([{ kind: "agenda", chatId: OWNER, ask: "week" }], {
      reply: async (_c, t) => {
        said.push(t);
      },
      askCto: () => {},
      record: async () => {},
      log: () => {},
    });
    expect(said).toEqual([AGENDA_NOT_WIRED]);
  });
});

it("the bot imports of the agenda its socket client alone", () => {
  const dir = import.meta.dirname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const m of text.matchAll(/from "(@cenacle\/agenda[^"]*)"/g)) {
      expect(m[1], file).toBe("@cenacle/agenda/prise");
    }
  }
});
