/**
 * Draft bench — the paths to sending (phase 4, B5), second half:
 * - replay: a decision cannot be taken back by replaying a request — not
 *   after a refusal, not with the token of an earlier start of the server,
 *   not from another page, another host name or a plain form;
 * - lapsed proposals: I answered meanwhile, the mail is gone, the mailbox
 *   was renumbered — nothing leaves; a Reply-To elsewhere is never used.
 */
import { UNDO_DELAY_MS } from "@cenacle/journal";
import { type Check, Checks, checkOutbox } from "./checks.ts";
import type { BenchContext } from "./context.ts";
import { choosing, DAY, proposed } from "./scenarios-send.ts";
import { pageHeaders, type World } from "./world.ts";

const MINUTE = 60_000;

const statusOf = async (world: World, id: string) => (await world.store.get(id))?.status;

export async function replay(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("rejeu");
  const world = ctx.world(ctx.due.slice(0, 2));
  const page = world.startPage();

  const refused = await proposed(world, 1, choosing("decliner"));
  c.equal("refusée", await world.act(page, refused, "refuse"), 200);
  c.equal("acceptée après refus", await world.act(page, refused, "accept"), 409);

  const id = await proposed(world, 2, choosing("decliner"));
  const restarted = world.startPage();
  const own = pageHeaders(restarted.token);
  const { origin: _, ...noOrigin } = own;
  const tries: [string, Record<string, string>, number][] = [
    ["le jeton d'un démarrage précédent", pageHeaders(page.token), 401],
    ["sans jeton", { ...own, authorization: "" }, 401],
    ["depuis une autre page", { ...own, origin: "http://evil.example" }, 403],
    ["sans origine", noOrigin, 403],
    ["un autre nom d'hôte (DNS rebinding)", { ...own, host: "evil.example:5173" }, 421],
    ["un simple formulaire", { ...own, "content-type": "text/plain" }, 415],
  ];
  for (const [label, headers, status] of tries) {
    c.equal(`accepter avec ${label}`, await world.act(restarted, id, "accept", headers), status);
  }
  c.equal("rien n'a été accepté", await statusOf(world, id), "pending");
  c.equal("la page du démarrage en cours accepte", await world.act(restarted, id, "accept"), 200);
  world.advance(UNDO_DELAY_MS);
  await world.execute();
  c.equal("la même requête rejouée", await world.act(restarted, id, "accept"), 409);
  world.advance(DAY);
  await world.execute();
  await checkOutbox(world, c, 1);
  return c.lines;
}

export async function lapsed(ctx: BenchContext): Promise<Check[]> {
  const c = new Checks("proposition caduque");
  const world = ctx.world(ctx.due.slice(0, 4));
  const page = world.startPage();
  const [answered = "", gone = "", diverted = "", vanished = ""] = [
    await proposed(world, 1, choosing("decliner")),
    await proposed(world, 2, choosing("decliner")),
    await proposed(world, 3, choosing("decliner")),
    await proposed(world, 4, choosing("decliner")),
  ];
  world.mailbox.replyTo.set(3, "pirate@detournement.example");
  const shown = (await (
    await page.app.request("/api/proposals", { headers: pageHeaders(page.token) })
  ).json()) as { proposals: { id: string; mail: { replyToElsewhere: boolean } | null }[] };
  c.that(
    "la page signale le Reply-To ailleurs",
    shown.proposals.find((p) => p.id === diverted)?.mail?.replyToElsewhere === true,
  );
  for (const id of [answered, gone, diverted]) {
    c.equal("acceptée", await world.act(page, id, "accept"), 200);
  }
  world.mailbox.mails.delete(4);
  c.equal("accepter quand le mail a disparu", await world.act(page, vanished, "accept"), 409);

  // Within the undo delay, I answer mail 1 myself and mail 2 is deleted.
  world.advance(UNDO_DELAY_MS - MINUTE);
  world.mailbox.answer(1, world.now());
  world.mailbox.mails.delete(2);
  world.advance(MINUTE);
  const round = await world.execute();
  c.equal(
    "j'ai répondu entre-temps · le mail a disparu",
    // Same send_after: the order between them is not guaranteed.
    round.lapsed.map((l) => `${l.id === answered ? "1" : "2"}:${l.reason}`).sort(),
    ["1:answered", "2:gone"],
  );
  c.equal("un Reply-To ailleurs : envoyé, à l'expéditeur", round.sent, [diverted]);
  c.equal(
    "statuts",
    [await statusOf(world, answered), await statusOf(world, gone)],
    ["lapsed", "lapsed"],
  );
  await checkOutbox(world, c, 1);

  const other = ctx.world(ctx.due.slice(4, 5));
  const otherPage = other.startPage();
  const id = await proposed(other, 1, choosing("decliner"));
  c.equal("acceptée", await other.act(otherPage, id, "accept"), 200);
  other.mailbox.uidValidity = "424242";
  other.advance(UNDO_DELAY_MS);
  c.equal("boîte renumérotée pendant le délai", (await other.execute()).sent, []);
  c.equal("boîte renumérotée : caduque", await statusOf(other, id), "lapsed");
  await checkOutbox(other, c, 0);
  return c.lines;
}
