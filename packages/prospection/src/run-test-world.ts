// The test harness of a pass (ADR-0032, ADR-0034): fictional mails, a model
// that answers what it is told, and every outcome recorded. Tests only.
import type { ApplicationToKeep, CardToKeep, Outcome, RunDeps } from "./run.ts";
import { testConfig } from "./test-config.ts";

export class ModelDown extends Error {}

export const source = (from: string, html: string) =>
  Buffer.from(
    `From: Alertes <${from}>\r\nSubject: Missions\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`,
    "utf8",
  );
export const ALERT = source(
  "alertes@plateforme.example",
  '<p>Ingénieur IA, Banque Fictive, Lyon <a href="https://plateforme.example/m/1">voir</a></p>',
);
export const ANSWER = JSON.stringify([
  {
    intitule: "Ingénieur IA",
    entreprise: "Banque Fictive",
    intermediaire: "direct",
    stack: ["Python"],
    tjm: [600, 700],
    teletravail: "total",
    lieu: "Lyon",
    lien: 1,
  },
]);

export interface World {
  readonly deps: RunDeps;
  readonly recorded: { id: number; outcome: Outcome; cards: readonly CardToKeep[] }[];
  readonly asked: string[];
  readonly systems: string[];
  readonly applications: { id: number; card: ApplicationToKeep }[];
  readonly events: { type: string; payload?: Record<string, unknown> }[];
}

export function world(
  mails: { id: number; auth?: boolean; source?: Buffer; complete?: boolean }[],
  over: Partial<RunDeps> = {},
): World {
  const recorded: World["recorded"] = [];
  const asked: string[] = [];
  const systems: string[] = [];
  const applications: World["applications"] = [];
  const events: World["events"] = [];
  const deps: RunDeps = {
    config: testConfig(),
    journal: { append: async (e) => events.push(e) },
    missionMails: async () => mails.map((m) => ({ id: m.id, senderAuthenticated: m.auth ?? true })),
    unread: async (ids) =>
      ids.filter(
        (id) => !recorded.some((r) => r.id === id) && !applications.some((a) => a.id === id),
      ),
    readSources: async (ids) =>
      mails
        .filter((m) => ids.includes(m.id) && m.source !== undefined)
        .map((m) => ({ uid: m.id, source: m.source as Buffer, complete: m.complete ?? true })),
    senderAddress: (s) => /^From:.*<([^>]+)>/im.exec(s.toString("utf8"))?.[1] ?? null,
    sensitive: (text) => /\bhandicap\b/i.test(text),
    ask: async (prompt, system) => {
      asked.push(prompt);
      systems.push(system);
      return ANSWER;
    },
    isModelUnavailable: (e) => e instanceof ModelDown,
    recordMail: async (id, outcome, cards) => {
      recorded.push({ id, outcome, cards });
      return { added: cards.length, duplicates: 0 };
    },
    recordApplication: async (id, card) => {
      applications.push({ id, card });
      return { added: true };
    },
    purge: async () => 0,
    retentionDays: 60,
    now: () => new Date("2026-10-22T10:00:00Z"),
    nonce: () => "n0",
    ...over,
  };
  return { deps, recorded, asked, systems, applications, events };
}
