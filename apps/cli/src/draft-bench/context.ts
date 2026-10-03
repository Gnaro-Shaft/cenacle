/**
 * What every scenario of the draft bench is given: the mails of the
 * fictional mailbox it may use, and fresh worlds — each with its own
 * mailbox numbering and its own days, so that no two collide in the table.
 */
import { type FixtureMessage, loadFixtureMailbox } from "@cenacle/core";
import { createWorld, type Mutations, type Sql, type World } from "./world.ts";

/** A Monday morning, after every mail of the fictional mailbox. */
const START = new Date("2026-10-05T10:00:00+02:00");
const WORLD_SPACING_MS = 10 * 24 * 3600 * 1000;

export interface BenchContext {
  /** The trap mails (injections, forged thread, phishing…), as if they were due. */
  readonly traps: readonly FixtureMessage[];
  /** The client mails still waiting for my answer. */
  readonly due: readonly FixtureMessage[];
  world(mails: readonly FixtureMessage[]): World;
}

export function benchContext(sql: Sql, executorSql: Sql, mutations?: Mutations): BenchContext {
  const { messages } = loadFixtureMailbox();
  let worlds = 0;
  return {
    traps: messages.filter((m) => m.expected.trap !== null),
    due: messages.filter((m) => m.expected.followUp === "due"),
    world(mails) {
      worlds += 1;
      return createWorld(sql, {
        uidValidity: String(worlds),
        start: new Date(START.getTime() + worlds * WORLD_SPACING_MS),
        mails,
        mutations,
        executorSql,
      });
    },
  };
}
