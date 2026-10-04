/**
 * What the draft bench records: one line per check, and the invariant every
 * world must hold at the end — each reply handed to SMTP matches a proposal
 * the page accepted, went to the sender of the mail, carries the text I saw,
 * and left once.
 */
import { UNDO_DELAY_MS } from "@cenacle/journal";
import type { World } from "./world.ts";

export interface Check {
  readonly scenario: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export class Checks {
  readonly lines: Check[] = [];
  private readonly scenario: string;
  constructor(scenario: string) {
    this.scenario = scenario;
  }

  that(name: string, ok: boolean, detail = ""): void {
    this.lines.push({ scenario: this.scenario, name, ok, detail });
  }
  equal<T>(name: string, actual: T, expected: T): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    this.that(
      name,
      ok,
      ok ? "" : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * The end-of-world invariant, both ways: every reply handed to SMTP matches a
 * proposal the page accepted at least 2 minutes before, and every proposal
 * recorded as being sent or sent has its reply in the outbox.
 */
export async function checkOutbox(world: World, c: Checks, expectedSends: number): Promise<void> {
  c.equal("réponses remises à SMTP", world.outbox.length, expectedSends);
  const seen = new Set<string>();
  for (const out of world.outbox) {
    const where = `mail ${out.uid}`;
    const mail = world.mailbox.mails.get(out.uid);
    const proposal = await world.proposalFor(out.uidValidity, out.uid);
    if (proposal === null) {
      c.that(`${where} : envoyé sans aucune proposition`, false);
      continue;
    }
    const acceptedAt = world.acceptedByPage.get(proposal.id);
    c.that(`${where} : accepté sur la page`, acceptedAt !== undefined);
    c.that(
      `${where} : parti 2 min au moins après l'acceptation`,
      acceptedAt !== undefined && out.at.getTime() - acceptedAt.getTime() >= UNDO_DELAY_MS,
    );
    c.equal(`${where} : noté envoyé`, proposal.status, "sent");
    c.that(`${where} : le texte que j'ai vu`, proposal.draft === out.text);
    c.that(
      `${where} : à l'expéditeur, jamais ailleurs`,
      mail !== undefined && out.to === mail.from.address.toLowerCase(),
    );
    c.that(`${where} : envoyé une fois`, !seen.has(proposal.id));
    seen.add(proposal.id);
  }
  const recorded = await world.sendingOrSent();
  c.equal("propositions notées envoyées = réponses remises", recorded, world.outbox.length);
}
