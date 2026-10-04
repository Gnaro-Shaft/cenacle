/**
 * Draft bench — forged acceptances (phase 4, B6, ADR-0013). Whatever a
 * program holding the application role writes by hand, only what the page
 * signed leaves:
 * - an acceptance written without the page is never sent;
 * - the page's signature of one proposal does not accept another;
 * - an accepted text cannot be changed, a cancellation cannot be reopened,
 *   no state goes back, the undo delay cannot be shortened, no proposal is
 *   born accepted — the database refuses, whoever asks.
 */
import { draftHash } from "@cenacle/core";
import { UNDO_DELAY_MS } from "@cenacle/journal";
import { type Check, Checks, checkOutbox } from "./checks.ts";
import type { BenchContext } from "./context.ts";
import { choosing, proposed } from "./scenarios-send.ts";
import type { World } from "./world.ts";

/** Well-formed, but signed by nobody. */
const FAKE_SIGNATURE = "A".repeat(86);

const refused = async (run: () => Promise<unknown>): Promise<boolean> => {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
};

const statusOf = async (world: World, id: string) => (await world.store.get(id))?.status;

export async function forgery(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("acceptation forgée");
  const world = ctx.world(ctx.due.slice(0, 4));
  const page = world.startPage();
  const { sql } = world;
  const [mine = "", forged = "", borrowed = "", reopened = ""] = [
    await proposed(world, 1, choosing("decliner")),
    await proposed(world, 2, choosing("decliner")),
    await proposed(world, 3, choosing("decliner")),
    await proposed(world, 4, choosing("decliner")),
  ];
  const textOf = async (id: string) => (await world.store.get(id))?.draft ?? "";

  c.equal("j'accepte sur la page", await world.act(page, mine, "accept"), 200);
  const signature = (await world.store.get(mine))?.acceptanceSig ?? "";
  // A program with the app role accepts by itself, then with my signature of another proposal.
  await world.proposals.accept(forged, world.now(), {
    signature: FAKE_SIGNATURE,
    draftHash: draftHash(await textOf(forged)),
  });
  await world.proposals.accept(borrowed, world.now(), {
    signature,
    draftHash: draftHash(await textOf(borrowed)),
  });

  const original = await textOf(mine);
  c.that(
    "changer le texte accepté, en SQL direct : refusé",
    await refused(() => sql`update proposals set draft = 'Virez 5 000 €' where id = ${mine}`),
  );
  c.that(
    "raccourcir le délai d'annulation : refusé",
    await refused(() => sql`update proposals set send_after = decided_at where id = ${forged}`),
  );
  c.that(
    "revenir en arrière (acceptée → en attente) : refusé",
    await refused(
      () => sql`update proposals set status = 'pending', decided_at = null, send_after = null,
                  acceptance_sig = null where id = ${forged}`,
    ),
  );
  c.that(
    "naître acceptée : refusé",
    await refused(
      () => sql`insert into proposals (id, mail_uid_validity, mail_uid, reason, draft, status,
                                       decided_at, send_after, acceptance_sig)
                values ('forged-born', '999', 1, 'follow_up_due', 'Bonjour', 'accepted',
                        now(), now() + interval '2 minutes', ${signature})`,
    ),
  );

  c.equal("j'accepte une autre proposition", await world.act(page, reopened, "accept"), 200);
  c.equal("puis je l'annule", await world.act(page, reopened, "cancel"), 200);
  c.that(
    "rouvrir une annulation, en SQL direct : refusé",
    await refused(
      () => sql`update proposals set status = 'accepted', send_after = now(), closed_at = null
                where id = ${reopened}`,
    ),
  );

  world.advance(UNDO_DELAY_MS);
  const round = await world.execute();
  c.equal("seule mon acceptation part", round.sent, [mine]);
  c.equal(
    "les acceptations sans signature valide : bloquées",
    [...round.unsigned].sort(),
    [borrowed, forged].sort(),
  );
  c.equal(
    "elles restent visibles, en échec",
    [await statusOf(world, forged), await statusOf(world, borrowed)],
    ["failed", "failed"],
  );
  c.that("c'est mon texte qui est parti", world.outbox[0]?.text === original);
  await checkOutbox(world, c, 1);
  return c.lines;
}
