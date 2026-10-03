/**
 * Draft bench — the paths to sending (phase 4, B5), first half:
 * - injection: the trap mails, drafted by a model that obeys them, never
 *   leave, however long the executor runs;
 * - double click: two acceptances, two executors at once — one reply;
 * - undo delay and slots: nothing before 2 minutes, nothing cancelled,
 *   nothing with a slot left for me.
 */
import { UNDO_DELAY_MS } from "@cenacle/journal";
import { type Check, Checks, checkOutbox } from "./checks.ts";
import type { BenchContext } from "./context.ts";
import { type HostileModel, TRAMES, votedFor, type World } from "./world.ts";

const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** A model that does what the mail says: any template, slots copied from the mail's orders. */
const obedient: HostileModel = {
  vote: (mail) => {
    const ids = [...TRAMES.trames.keys()];
    return votedFor(ids[mail.uid % ids.length] ?? null);
  },
  copy: (mail, slots) => Object.fromEntries(slots.map((s) => [s, mail.text.slice(0, 80)])),
};

export const choosing = (trame: string): HostileModel => ({
  vote: () => votedFor(trame),
  copy: () => ({}),
});

/** Lets two executors reach their claim before either goes on (bounded wait, then said). */
function barrier(n: number): { wait: () => Promise<void>; met: () => boolean } {
  let arrived = 0;
  let release = () => {};
  const all = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait: async () => {
      arrived += 1;
      if (arrived >= n) release();
      await Promise.race([all, new Promise((r) => setTimeout(r, 500))]);
    },
    met: () => arrived >= n,
  };
}

export async function proposed(world: World, uid: number, model: HostileModel): Promise<string> {
  const outcome = await world.draft(uid, model);
  if (outcome.kind !== "proposed") throw new Error(`mail ${uid}: nothing proposed`);
  return outcome.proposalId;
}

export async function injection(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("injection");
  const world = ctx.world(ctx.traps);
  const ids: string[] = [];
  for (const uid of world.mailbox.mails.keys()) {
    ids.push((await world.draft(uid, obedient)).proposalId);
  }
  // The executor runs every 10 minutes for three days.
  for (let t = 0; t < 3 * DAY; t += 10 * MINUTE) {
    world.advance(10 * MINUTE);
    await world.execute();
  }
  const statuses = await Promise.all(ids.map(async (id) => (await world.store.get(id))?.status));
  c.that(
    `${ids.length} mails pièges : aucun accepté, aucun envoyé`,
    statuses.every((s) => s === "pending" || s === "skipped"),
    statuses.join(" "),
  );
  await checkOutbox(world, c, 0);
  return c.lines;
}

export async function doubleClick(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("double clic");
  const world = ctx.world(ctx.due.slice(0, 1));
  const id = await proposed(world, 1, choosing("decliner"));
  const page = world.startPage();
  const clicks = await Promise.all([world.act(page, id, "accept"), world.act(page, id, "accept")]);
  c.equal("deux clics à la fois : une acceptation", [...clicks].sort(), [200, 409]);
  world.advance(UNDO_DELAY_MS);
  const meeting = barrier(2);
  const rounds = await Promise.allSettled([
    world.execute(meeting.wait),
    world.execute(meeting.wait),
  ]);
  c.that("les deux exécuteurs arrivent ensemble à la prise", meeting.met());
  c.that(
    "deux exécuteurs à la fois : aucun plantage",
    rounds.every((r) => r.status === "fulfilled"),
    rounds.map((r) => (r.status === "rejected" ? String(r.reason) : "ok")).join(" · "),
  );
  world.advance(DAY);
  await world.execute();
  c.equal("un clic sur une proposition envoyée", await world.act(page, id, "accept"), 409);
  await checkOutbox(world, c, 1);
  return c.lines;
}

export async function undoDelay(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("délai et cases");
  const world = ctx.world(ctx.due.slice(0, 3));
  const page = world.startPage();

  const kept = await proposed(world, 1, choosing("decliner"));
  c.equal("acceptée", await world.act(page, kept, "accept"), 200);
  world.advance(UNDO_DELAY_MS - 1000);
  c.equal("à 1 min 59 s : rien n'est parti", (await world.execute()).sent, []);
  world.advance(1000);
  c.equal("à 2 min : envoyée", (await world.execute()).sent, [kept]);
  c.equal("annuler après l'envoi", await world.act(page, kept, "cancel"), 409);

  const undone = await proposed(world, 2, choosing("decliner"));
  c.equal("acceptée", await world.act(page, undone, "accept"), 200);
  world.advance(UNDO_DELAY_MS - 1000);
  c.equal("annulée à 1 min 59 s", await world.act(page, undone, "cancel"), 200);
  c.equal("réaccepter après annulation", await world.act(page, undone, "accept"), 409);
  world.advance(DAY);
  c.equal("un jour plus tard : rien n'est parti", (await world.execute()).sent, []);

  const slot = await proposed(world, 3, choosing("accuse_reception"));
  c.equal("une case à moi restante : refusé", await world.act(page, slot, "accept"), 409);
  const draft = (await world.store.get(slot))?.draft ?? "";
  const mine = draft.replace(/\{[a-z_]+ \?\}/g, "d'ici la fin de semaine");
  c.equal(
    "je complète la case",
    await world.act(page, slot, "draft", undefined, JSON.stringify({ draft: mine })),
    200,
  );
  c.equal("puis j'accepte", await world.act(page, slot, "accept"), 200);
  world.advance(UNDO_DELAY_MS);
  c.equal("envoyée après le délai", (await world.execute()).sent, [slot]);
  c.that("c'est mon texte qui est parti", world.outbox.at(-1)?.text === mine);
  await checkOutbox(world, c, 2);
  return c.lines;
}
