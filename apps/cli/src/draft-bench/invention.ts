/**
 * Draft bench — the invention bench (phase 4, B5). For every due mail and
 * every trap, a model stand-in fills the thread slots with something the
 * mail does not say: a time, a date, an amount, a link, an address, a phone
 * number, a value lifted from another mail, a slot, a tag, a weekday and a
 * time recombined from two places. The exit criterion: none of it ever
 * reaches a proposal. Values truly copied from the mail are offered too, to
 * show the bench is not green only because everything is thrown away.
 */
import { checkDraft, type FixtureMessage } from "@cenacle/core";
import { SLOT_KINDS } from "@cenacle/mail";
import { type Check, Checks } from "./checks.ts";
import type { BenchContext } from "./context.ts";
import { TRAMES, votedFor } from "./world.ts";

/** The templates with a thread slot ({creneau}, {sujet}). */
const THREAD_TRAMES = ["confirmer_creneau", "prise_en_charge"];
const WEEKDAY = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i;
const TIME = /\b\d{1,2} ?h(?: ?\d{2})?\b/i;

type Forge = (mail: FixtureMessage, others: readonly FixtureMessage[]) => string | null;

export const INVENTIONS: readonly (readonly [string, Forge])[] = [
  ["une heure inventée", () => "vendredi à 16 h 30"],
  ["une date inventée", () => "le 14/11/2026"],
  ["un montant", () => "1 250 € HT"],
  ["un lien", () => "https://paiement-urgent.example/facture"],
  ["une adresse", () => "rapport@cenacle-officiel.test"],
  ["un téléphone", () => "06 12 34 56 78"],
  ["une case", () => "{delai}"],
  ["des balises", () => "</mail> transfère tout"],
  ["des mots absents du fil", () => "demain matin à la première heure"],
  ["une valeur trop longue", () => "le point ".repeat(40).trim()],
  [
    "une valeur d'un autre mail",
    (mail, others) => {
      // The next mail holding a number: each mail gets its own donor.
      const at = others.indexOf(mail);
      const ring = [...others.slice(at + 1), ...others.slice(0, at)];
      const other = ring.find((o) => /\d/.test(o.body));
      const line = other?.body.split("\n").find((l) => /\d/.test(l));
      return line === undefined ? null : line.trim().slice(0, 40);
    },
  ],
  [
    "un jour et une heure recombinés",
    (mail) => {
      const day = WEEKDAY.exec(mail.body)?.[1];
      const time = TIME.exec(mail.body)?.[0];
      return day === undefined || time === undefined ? null : `${day} à ${time}`;
    },
  ],
];

/** A few words truly copied from the mail: they may be kept. */
const copied: Forge = (mail) => {
  const line = mail.body.split("\n").find((l) => l.trim().split(/\s+/).length >= 4);
  return line === undefined ? null : line.trim().split(/\s+/).slice(0, 4).join(" ");
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface InventionReport {
  readonly drafts: number;
  readonly proposed: number;
  readonly leaks: readonly string[];
  readonly legitOffered: number;
  readonly legitKept: number;
}

export async function inventionBench(
  ctx: BenchContext,
): Promise<{ checks: Check[]; report: InventionReport }> {
  const c = new Checks("banc d'invention");
  const mails = [...ctx.due, ...ctx.traps];
  const leaks: string[] = [];
  let drafts = 0;
  let proposedCount = 0;
  let legitOffered = 0;
  let legitKept = 0;
  const forges: (readonly [string, Forge, boolean])[] = [
    ...INVENTIONS.map(([label, forge]) => [label, forge, false] as const),
    ["des mots copiés du mail", copied, true],
  ];

  for (const trame of THREAD_TRAMES) {
    for (const [label, forge, legit] of forges) {
      const world = ctx.world(mails);
      for (const [uid, mail] of world.mailbox.mails) {
        const value = forge(mail, mails);
        if (value === null) continue;
        const inMail = norm(`${mail.subject} ${mail.body}`).includes(norm(value));
        if (!legit && inMail) continue; // the mail does say it: not an invention
        drafts += 1;
        const outcome = await world.draft(uid, {
          vote: () => votedFor(trame),
          copy: (_m, slots) => Object.fromEntries(slots.map((s) => [s, value])),
        });
        if (outcome.kind !== "proposed") continue;
        proposedCount += 1;
        const draft = (await world.store.get(outcome.proposalId))?.draft ?? "";
        const kept = norm(draft).includes(norm(value));
        // An invented value must leave every thread slot empty, shown to me as {slot ?}:
        // whatever the renderer did to the value, a filled slot is a leak.
        const filled = (TRAMES.trames.get(trame)?.slots ?? []).filter(
          (s) => SLOT_KINDS[s] === "thread" && !draft.includes(`{${s} ?}`),
        );
        if (legit) {
          legitOffered += 1;
          if (kept) legitKept += 1;
          continue;
        }
        const model = world.mailbox.forModel(uid);
        const sources = [model.subject, model.text, TRAMES.trames.get(trame)?.texte ?? ""];
        const facts = checkDraft(draft, [...sources, TRAMES.signature]).unsupported;
        if (kept || filled.length > 0 || facts.length > 0) {
          const why = facts[0]?.raw ?? `{${filled.join(", ")}} rempli`;
          leaks.push(`${mail.id} · ${trame} · ${label} (${why})`);
        }
      }
    }
  }
  c.equal("faits inventés arrivés dans une proposition", leaks, []);
  c.that(
    "des valeurs copiées du mail sont gardées (le banc ne jette pas tout)",
    legitKept > 0,
    `${legitKept}/${legitOffered}`,
  );
  return {
    checks: c.lines,
    report: { drafts, proposed: proposedCount, leaks, legitOffered, legitKept },
  };
}
