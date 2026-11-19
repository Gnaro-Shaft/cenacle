/**
 * The four tables' own purges, replayed after a reload (ADR-0044, point 7):
 * a copy holds rows that were due to go since; they go before any service
 * reads them again. The same stores and the same retentions as the services
 * (the cadre's for the reminders and the cards, veille.toml's for the
 * articles, the store's own for the findings). A retention missing from the
 * cadre: that purge is not replayed, and said — the service refuses then too.
 */
import {
  createProspectionStore,
  createRappelStore,
  createSecuriteStore,
  createVeilleStore,
} from "@cenacle/journal";
import type { Sql } from "postgres";

export interface Retentions {
  readonly rappelsJours: number | undefined;
  readonly prospectionJours: number | undefined;
  readonly veilleJours: number;
}

const DAY_MS = 86_400_000;

/** Rows purged per table, or null when its retention is missing. */
export async function replayPurges(
  sql: Sql,
  days: Retentions,
  now: Date,
): Promise<Map<string, number | null>> {
  const before = (n: number) => new Date(now.getTime() - n * DAY_MS);
  const out = new Map<string, number | null>();
  out.set(
    "rappels",
    days.rappelsJours === undefined
      ? null
      : await createRappelStore(sql).purge(before(days.rappelsJours)),
  );
  out.set(
    "prospection_cartes",
    days.prospectionJours === undefined
      ? null
      : await createProspectionStore(sql).purge(before(days.prospectionJours)),
  );
  out.set("veille_articles", await createVeilleStore(sql).purge(before(days.veilleJours)));
  out.set("securite_constats", await createSecuriteStore(sql).purge(now));
  return out;
}
