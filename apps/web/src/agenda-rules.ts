/**
 * The Agenda tab's rules (ADR-0042, point 6): the appointments day by day, in
 * Paris time, whatever the zone of the machine showing the page; a whole day
 * on each day it covers; an appointment begun before the window on its first
 * day. Each failure and each reason has its words: an agenda shown emptier
 * than it is is worse than no agenda.
 */
import type { AgendaEvent, AgendaFailure, AgendaReason } from "./api.ts";

const PARIS = "Europe/Paris";

export const FAILURE_LABEL: Readonly<Record<AgendaFailure, string>> = {
  refus: "le serveur refuse le mot de passe",
  injoignable: "serveur injoignable",
  delai: "le serveur a mis trop de temps",
  illisible: "réponse illisible",
  hote: "une adresse hors des hôtes admis a été écartée",
  config: "mot de passe absent de .env.agenda",
};

export const REASON_LABEL: Readonly<Record<AgendaReason, string>> = {
  "fuseau-inconnu": "fuseau horaire inconnu",
  "heure-flottante": "heure sans fuseau",
  "serie-non-etendue": "série que le serveur n'a pas étendue",
  illisible: "illisible",
  "trop-nombreux": "au-delà de 5000 rendez-vous pour ce compte, non montré",
};

const dayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  hour: "2-digit",
  minute: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const shortDay = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
});

/** "2026-11-17": the Paris date of an instant. */
export function parisDay(instant: number): string {
  const parts = dayParts.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const utcOf = (day: string) => {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** The day `n` days after this one. */
export function addDay(day: string, n: number): string {
  return new Date(utcOf(day) + n * 86_400_000).toISOString().slice(0, 10);
}

type Timed = AgendaEvent & { readonly kind: "heure" };

/** "09:00–10:00", "09:00" when it has no length, "22:00 → mer. 18 01:00" across a night. */
export function hoursOf(event: Timed): string {
  const from = hourFormat.format(event.start);
  if (event.end === event.start) return from;
  const to = hourFormat.format(event.end);
  const startDay = parisDay(event.start);
  const endDay = parisDay(event.end);
  // An end at midnight closes the day it began.
  const sameDay = endDay === startDay || (to === "00:00" && addDay(startDay, 1) === endDay);
  return sameDay ? `${from}–${to}` : `${from} → ${shortDay.format(utcOf(endDay))} ${to}`;
}

export interface Day {
  /** "2026-11-17". */
  readonly day: string;
  /** "mardi 17 novembre". */
  readonly label: string;
  readonly allDay: readonly AgendaEvent[];
  readonly timed: readonly Timed[];
}

/** The window's days, each with its whole days and its timed appointments, in order. */
export function daysOf(from: string, days: number, events: readonly AgendaEvent[]): Day[] {
  const out: Day[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDay(from, i);
    out.push({
      day,
      label: dayLabel.format(utcOf(day)),
      allDay: events.filter((e) => e.kind === "journee" && e.first <= day && e.last >= day),
      timed: events.filter((e): e is Timed => {
        if (e.kind !== "heure") return false;
        const start = parisDay(e.start);
        return (start < from ? from : start) === day;
      }),
    });
  }
  return out;
}
