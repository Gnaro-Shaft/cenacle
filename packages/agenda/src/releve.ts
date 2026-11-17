/**
 * Finding an account's calendars, then reading each (ADR-0042, points 2 and
 * 3): the principal, its calendar home, the calendars that carry events (less
 * those excluded by displayed name), then one REPORT per calendar asking only
 * for the title, the start, the end or duration and the recurrence rule —
 * CalDAV's partial retrieval (RFC 4791, § 9.6) — with the series expanded by
 * the server. Every address an answer gives is resolved against the request's
 * and goes through the transport, which admits it or not.
 */
import { calendarKey } from "./config.ts";
import { type EventRead, readCalendarData } from "./ical.ts";
import { caldavUtc } from "./times.ts";
import type { Answer, DavRequest } from "./transport.ts";
import { CALDAV, childOf, childrenOf, DAV, parseXml, pathOf, type XmlElement } from "./xml.ts";

export type Failure = "refus" | "injoignable" | "delai" | "illisible" | "hote";
export type Send = (request: DavRequest) => Promise<Answer>;

export const MAX_CALENDARS = 64;

const PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

const HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

const LIST = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>`;

/** The REPORT of one window: the fields named, the series expanded, the time range filtered. */
export function reportBody(start: number, end: number): string {
  const s = caldavUtc(start);
  const e = caldavUtc(end);
  const props = ["SUMMARY", "DTSTART", "DTEND", "DURATION", "RRULE"]
    .map((p) => `<c:prop name="${p}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:comp name="VCALENDAR"><c:comp name="VEVENT">${props}</c:comp></c:comp><c:expand start="${s}" end="${e}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${s}" end="${e}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

interface Found {
  readonly href: URL;
  /** The properties of the propstats whose status is 200, merged. */
  readonly props: readonly XmlElement[];
}

/** One request whose answer must be a 207 multistatus; its responses, or the failure. */
async function ask(send: Send, request: DavRequest): Promise<Found[] | Failure> {
  const answer = await send(request);
  if (typeof answer === "string") return answer;
  if (answer.status !== 207) return "illisible";
  let root: XmlElement;
  try {
    root = parseXml(answer.body);
  } catch {
    return "illisible";
  }
  if (root.ns !== DAV || root.name !== "multistatus") return "illisible";
  const found: Found[] = [];
  for (const response of childrenOf(root, DAV, "response")) {
    const href = childOf(response, DAV, "href")?.text.trim() ?? "";
    let url: URL;
    try {
      url = new URL(href, request.url);
    } catch {
      return "illisible";
    }
    const props = childrenOf(response, DAV, "propstat")
      .filter((ps) => / 200 /.test(` ${childOf(ps, DAV, "status")?.text.trim() ?? ""} `))
      .flatMap((ps) => childrenOf(ps, DAV, "prop"));
    found.push({ href: url, props });
  }
  return found;
}

/** The first property {ns}name among a response's props. */
function propOf(props: readonly XmlElement[], ns: string, name: string): XmlElement | null {
  for (const p of props) {
    const found = childOf(p, ns, name);
    if (found !== null) return found;
  }
  return null;
}

/** The URL in the {ns}name/href property of the first response that has one, resolved. */
function hrefProp(found: readonly Found[], base: URL, ns: string, name: string): URL | null {
  for (const f of found) {
    const prop = propOf(f.props, ns, name);
    const href = prop === null ? "" : (pathOf(prop, [DAV, "href"])?.text.trim() ?? "");
    if (href === "") continue;
    try {
      return new URL(href, base);
    } catch {
      return null;
    }
  }
  return null;
}

/** A calendar (not a plain folder) whose components may include events. */
function carriesEvents(props: readonly XmlElement[]): boolean {
  const type = propOf(props, DAV, "resourcetype");
  if (type === null || childOf(type, CALDAV, "calendar") === null) return false;
  const set = propOf(props, CALDAV, "supported-calendar-component-set");
  // No set said: a calendar may carry anything, events included.
  if (set === null) return true;
  return childrenOf(set, CALDAV, "comp").some((c) => c.attrs.name?.toUpperCase() === "VEVENT");
}

/** The account's calendars that carry events, less the excluded ones. */
export async function discover(
  send: Send,
  server: URL,
  excluded: ReadonlySet<string>,
): Promise<URL[] | Failure> {
  const first = await ask(send, { method: "PROPFIND", url: server, depth: "0", body: PRINCIPAL });
  if (typeof first === "string") return first;
  const principal = hrefProp(first, server, DAV, "current-user-principal");
  if (principal === null) return "illisible";
  const second = await ask(send, { method: "PROPFIND", url: principal, depth: "0", body: HOME });
  if (typeof second === "string") return second;
  const home = hrefProp(second, principal, CALDAV, "calendar-home-set");
  if (home === null) return "illisible";
  const third = await ask(send, { method: "PROPFIND", url: home, depth: "1", body: LIST });
  if (typeof third === "string") return third;
  const calendars: URL[] = [];
  for (const f of third) {
    if (f.href.href === home.href || !carriesEvents(f.props)) continue;
    const name = propOf(f.props, DAV, "displayname");
    if (name !== null && excluded.has(calendarKey(name.text))) continue;
    calendars.push(f.href);
    if (calendars.length >= MAX_CALENDARS) break;
  }
  return calendars;
}

/** One calendar's events in the window, as the server expanded them. */
export async function readCalendar(
  send: Send,
  calendar: URL,
  start: number,
  end: number,
): Promise<EventRead[] | Failure> {
  const found = await ask(send, {
    method: "REPORT",
    url: calendar,
    depth: "1",
    body: reportBody(start, end),
  });
  if (typeof found === "string") return found;
  return found.flatMap((f) => {
    const data = propOf(f.props, CALDAV, "calendar-data");
    return data === null ? [] : readCalendarData(data.text);
  });
}
