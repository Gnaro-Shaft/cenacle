// One reading of the agenda (ADR-0042), against fake CalDAV servers: an
// account down does not hide the others; a refusal and an outage are said
// apart; an excluded calendar, or one without events, is never asked; only
// titles and times come out; the log says a name and a word, nothing else;
// nothing is kept — not even between two readings — and the code writes
// nowhere (a test reads it).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgendaAccount, parseAgendaConfig } from "./config.ts";
import { createAgenda } from "./lecture.ts";
import { reportBody, type Send } from "./releve.ts";
import { type Answer, admits, type DavRequest } from "./transport.ts";

const NOW = Date.parse("2026-11-17T07:00:00Z"); // 08:00 in Paris
const ms = (inner: string) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
const ok = "<d:status>HTTP/1.1 200 OK</d:status>";
const resp = (href: string, prop: string) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop>${ok}</d:propstat></d:response>`;
const calendar = (href: string, name: string, comps = ["VEVENT"]) =>
  resp(
    href,
    `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${name}</d:displayname><c:supported-calendar-component-set>${comps.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set>`,
  );
const vcal = (...events: string[][]) =>
  `<![CDATA[BEGIN:VCALENDAR\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e.join("\r\n")}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR]]>`;

interface FakeServer {
  readonly asked: string[];
  readonly answer: (req: DavRequest, signal: AbortSignal) => Promise<Answer>;
}

/** A CalDAV server: principal /p/, home /h/, three calendars and an inbox. */
function server(events: string[][], first: Answer | null = null, home = "/h/"): FakeServer {
  const asked: string[] = [];
  const answer = async (req: DavRequest): Promise<Answer> => {
    asked.push(`${req.method} ${req.url.pathname}`);
    if (first !== null) return first;
    const path = req.url.pathname;
    const multi = (inner: string): Answer => ({ status: 207, body: ms(inner) });
    if (req.method === "PROPFIND" && path === "/dav/") {
      return multi(
        resp("/dav/", "<d:current-user-principal><d:href>/p/</d:href></d:current-user-principal>"),
      );
    }
    if (req.method === "PROPFIND" && path === "/p/") {
      return multi(
        resp("/p/", `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`),
      );
    }
    if (req.method === "PROPFIND" && path === "/h/") {
      return multi(
        resp("/h/", "<d:resourcetype><d:collection/></d:resourcetype>") +
          calendar("/h/travail/", "Travail") +
          calendar("/h/rappels/", "Rappels de Legion") +
          calendar("/h/taches/", "Tâches", ["VTODO"]) +
          resp("/h/inbox/", "<d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype>"),
      );
    }
    if (req.method === "REPORT" && path === "/h/travail/") {
      return multi(
        resp("/h/travail/e1.ics", `<c:calendar-data>${vcal(...events)}</c:calendar-data>`),
      );
    }
    return { status: 404, body: "" };
  };
  return { asked, answer };
}

const TOML = (names: string[]) =>
  names
    .map(
      (n) =>
        `[[compte]]\nnom = "${n}"\nserveur = "https://${n}.exemple.test/dav/"\nidentifiant = "moi.${n}@exemple.test"\nexclus = ["Rappels de Legion"]\n`,
    )
    .join("");
const ENV = {
  CENACLE_AGENDA_MOT_DE_PASSE_PRO: "pw-pro",
  CENACLE_AGENDA_MOT_DE_PASSE_PERSO: "pw-perso",
};

function reader(
  servers: Record<string, FakeServer>,
  env: NodeJS.ProcessEnv = ENV,
  deadline = 5000,
) {
  const logs: string[] = [];
  const read = createAgenda({
    config: () => parseAgendaConfig(TOML(Object.keys(servers)), env),
    transport: (account: AgendaAccount, signal) => {
      const creds = {
        login: account.login,
        password: account.password ?? "",
        admitted: account.admitted,
      };
      const s = servers[account.name];
      const send: Send = (req) =>
        admits(creds, req.url) && s !== undefined ? s.answer(req, signal) : Promise.resolve("hote");
      return send;
    },
    now: () => NOW,
    log: (line) => logs.push(line),
    accountDeadlineMs: deadline,
  });
  return { read, logs };
}

const MEETING = [
  "SUMMARY:Rendez-vous avec M. Untel",
  "DTSTART:20261117T130000Z",
  "DTEND:20261117T140000Z",
  "ATTENDEE:mailto:untel@exemple.test",
  "LOCATION:Chez Untel",
];

describe("an account down does not hide the others", () => {
  it("one refused, the other shown; the log says the name and the word", async () => {
    const { read, logs } = reader({ pro: server([MEETING]), perso: server([], "refus") });
    const view = await read(7);
    if (view.read !== "ok") throw new Error(view.read);
    expect(view.accounts).toEqual([
      { name: "pro", state: "ok" },
      { name: "perso", state: "refus" },
    ]);
    expect(view.events).toHaveLength(1);
    expect(logs).toEqual(["agenda : perso refus"]);
  });

  it.each(["refus", "injoignable", "delai", "illisible", "hote"] as const)(
    "each failure keeps its own word: %s",
    async (word) => {
      const { read } = reader({ pro: server([], word) });
      const view = await read(7);
      expect(view.read === "ok" && view.accounts[0]?.state).toBe(word);
    },
  );

  it("a home on a host not admitted: hote, and that host is never asked", async () => {
    const pro = server([], null, "https://ailleurs.exemple.test/h/");
    const { read } = reader({ pro });
    const view = await read(7);
    expect(view.read === "ok" && view.accounts[0]?.state).toBe("hote");
    expect(pro.asked).toEqual(["PROPFIND /dav/", "PROPFIND /p/"]);
  });

  it("no password: said as config, nothing sent", async () => {
    const pro = server([MEETING]);
    const { read, logs } = reader({ pro }, {});
    const view = await read(7);
    expect(view.read === "ok" && view.accounts[0]?.state).toBe("config");
    expect(pro.asked).toEqual([]);
    expect(logs).toEqual(["agenda : pro config"]);
  });

  it("an account past its deadline: delai, the other shown in time", async () => {
    const stuck: FakeServer = {
      asked: [],
      answer: (_, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve("delai"))),
    };
    const { read } = reader({ pro: server([MEETING]), perso: stuck }, ENV, 150);
    const started = Date.now();
    const view = await read(7);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(view.read === "ok" && view.accounts.map((a) => a.state)).toEqual(["ok", "delai"]);
  });
});

describe("what is asked, what comes out", () => {
  it("an excluded calendar, a calendar of tasks and the inbox are never asked", async () => {
    const pro = server([MEETING]);
    await reader({ pro }).read(7);
    expect(pro.asked).toEqual([
      "PROPFIND /dav/",
      "PROPFIND /p/",
      "PROPFIND /h/",
      "REPORT /h/travail/",
    ]);
  });

  it("the REPORT asks for the title and times only, the series expanded, the range filtered", () => {
    const body = reportBody(Date.parse("2026-11-16T23:00:00Z"), Date.parse("2026-11-23T23:00:00Z"));
    const props = [...body.matchAll(/<c:prop name="([A-Z-]+)"\/>/g)].map((m) => m[1]);
    expect(props).toEqual(["SUMMARY", "DTSTART", "DTEND", "DURATION", "RRULE"]);
    expect(body).toContain('<c:expand start="20261116T230000Z" end="20261123T230000Z"/>');
    expect(body).toContain('<c:time-range start="20261116T230000Z" end="20261123T230000Z"/>');
  });

  it("only titles and times; set-aside counted by reason; outside the window dropped; sorted", async () => {
    const { read } = reader({
      pro: server([
        MEETING,
        ["SUMMARY:Congé", "DTSTART;VALUE=DATE:20261117", "DTEND;VALUE=DATE:20261118"],
        ["SUMMARY:Petit-déjeuner", "DTSTART;TZID=Europe/Paris:20261117T083000"],
        ["SUMMARY:Flottant chez Untel", "DTSTART:20261117T090000"],
        ["SUMMARY:Série", "DTSTART:20261117T090000Z", "RRULE:FREQ=DAILY"],
        ["SUMMARY:Hier", "DTSTART:20261116T090000Z", "DTEND:20261116T100000Z"],
      ]),
    });
    const view = await read(7);
    if (view.read !== "ok") throw new Error(view.read);
    expect(view.from).toBe("2026-11-17");
    expect(view.events.map((e) => e.title)).toEqual([
      "Congé",
      "Petit-déjeuner",
      "Rendez-vous avec M. Untel",
    ]);
    for (const e of view.events) {
      expect(Object.keys(e).sort()).toEqual(
        e.kind === "heure"
          ? ["account", "end", "kind", "start", "title"]
          : ["account", "first", "kind", "last", "title"],
      );
    }
    expect(view.setAside).toEqual([
      { account: "pro", reason: "heure-flottante", count: 1 },
      { account: "pro", reason: "serie-non-etendue", count: 1 },
    ]);
    const text = JSON.stringify(view);
    expect(text).not.toContain("untel@");
    expect(text).not.toContain("Chez Untel");
    expect(text).not.toContain("Flottant");
  });

  it("the log never says a title, a login, an address", async () => {
    const { read, logs } = reader({ pro: server([], "illisible"), perso: server([], "hote") });
    await read(7);
    expect(logs).toEqual(["agenda : pro illisible", "agenda : perso hote"]);
    for (const line of logs) expect(line).toMatch(/^agenda : [a-z][a-z0-9_]* [a-z]+$/);
  });
});

describe("nothing kept", () => {
  it("two calls at once share one reading; the next call reads again", async () => {
    const pro = server([MEETING]);
    const { read } = reader({ pro });
    const [a, b] = [read(7), read(7)];
    expect(a).toBe(b);
    await a;
    expect(pro.asked.filter((x) => x === "PROPFIND /dav/")).toHaveLength(1);
    await read(7);
    expect(pro.asked.filter((x) => x === "PROPFIND /dav/")).toHaveLength(2);
  });

  it("a window out of bounds is refused", async () => {
    const { read } = reader({ pro: server([]) });
    for (const days of [0, 32, 1.5, Number.NaN]) await expect(read(days)).rejects.toThrow();
  });

  it("the package's code writes nowhere: no file written, no database, no console", () => {
    const dir = import.meta.dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(
        /writeFile|appendFile|createWriteStream|mkdir|unlink|rmSync|renameSync/,
      );
      expect(text, file).not.toMatch(/@cenacle\/journal|postgres|console\./);
      const fsImports = [...text.matchAll(/import \{([^}]*)\} from "node:fs"/g)].map((m) =>
        m[1]?.trim(),
      );
      expect(
        fsImports.every((names) => names === "readFileSync"),
        file,
      ).toBe(true);
    }
  });
});
