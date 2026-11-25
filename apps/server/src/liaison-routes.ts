/**
 * The « Maison » tab's routes (ADR-0048), behind the page's token and origin
 * (guard.ts, mounted by app.ts): the view, a new demand, my edit, my
 * acceptance (signed by the service), my refusal, my cancel. A refusal written
 * by the code is shown as is (409); anything else is an internal error that
 * never says more — never a text of a demand in a log.
 */
import type { Context, Hono } from "hono";
import { type ApiLog, internalLine } from "./api-log.ts";
import { LiaisonPageError, type LiaisonService } from "./liaison-service.ts";

const ID_RULE = /^[1-9][0-9]{0,15}$/;
/** A demand is 4 000 characters at most; four bytes each, and room for the rest. */
const MAX_BODY = 20 * 1024;

async function body(c: Context): Promise<Record<string, unknown> | Response> {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "too large" }, 413);
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return c.json({ error: "invalid body" }, 400);
  }
  return parsed as Record<string, unknown>;
}

type OnOne = (s: LiaisonService, id: number, input: Record<string, unknown>) => Promise<void>;

export function mountLiaison(
  app: Hono,
  liaison: LiaisonService | undefined,
  log: ApiLog = (line) => console.error(line),
): void {
  const failure = (c: Context, error: unknown): Response => {
    if (error instanceof LiaisonPageError) return c.json({ error: error.message }, 409);
    log(internalLine(c, error));
    return c.json({ error: "internal error" }, 500);
  };
  const absent = (c: Context) => c.json({ error: "la liaison n'est pas branchée" }, 503);

  app.get("/api/liaison", async (c) => {
    if (liaison === undefined) return absent(c);
    try {
      return c.json(await liaison.view());
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/api/liaison/demandes", async (c) => {
    if (liaison === undefined) return absent(c);
    const input = await body(c);
    if (input instanceof Response) return input;
    try {
      return c.json({ id: await liaison.create(input) });
    } catch (error) {
      return failure(c, error);
    }
  });

  const onOne = (run: OnOne) => async (c: Context) => {
    if (liaison === undefined) return absent(c);
    const id = c.req.param("id") ?? "";
    if (!ID_RULE.test(id)) return c.json({ error: "unknown demand" }, 404);
    const input = await body(c);
    if (input instanceof Response) return input;
    try {
      await run(liaison, Number(id), input);
      return c.json({ ok: true });
    } catch (error) {
      return failure(c, error);
    }
  };

  app.put(
    "/api/liaison/demandes/:id",
    onOne((s, id, input) => s.edit(id, input)),
  );
  app.post(
    "/api/liaison/demandes/:id/accepter",
    onOne((s, id, input) => s.accept(id, input)),
  );
  app.post(
    "/api/liaison/demandes/:id/refuser",
    onOne((s, id) => s.refuse(id)),
  );
  app.post(
    "/api/liaison/demandes/:id/annuler",
    onOne((s, id) => s.cancel(id)),
  );
}
