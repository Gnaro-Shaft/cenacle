/**
 * The board's routes (ADR-0032, points 15 to 17), behind the page's token
 * and origin (guard.ts, mounted by app.ts): list, add a card by hand, move
 * one. A refusal written by the code is shown as is; anything else is an
 * internal error that never says more.
 */
import type { Context, Hono } from "hono";
import { BoardError, type ProspectionService } from "./prospection-service.ts";

const CARD_ID_RULE = /^[1-9][0-9]{0,15}$/;
const MAX_BODY = 16 * 1024;

async function body(c: Context): Promise<Record<string, unknown> | Response> {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "too large" }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return c.json({ error: "invalid body" }, 400);
  }
  return parsed as Record<string, unknown>;
}

function failure(c: Context, error: unknown): Response {
  if (error instanceof BoardError) return c.json({ error: error.message }, 409);
  return c.json({ error: "internal error" }, 500);
}

export function mountProspection(app: Hono, board: ProspectionService | undefined): void {
  const absent = (c: Context) => c.json({ error: "le tableau n'est pas branché" }, 503);

  app.get("/api/prospection/cartes", async (c) => {
    if (board === undefined) return absent(c);
    try {
      return c.json({ cards: await board.list() });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/api/prospection/cartes", async (c) => {
    if (board === undefined) return absent(c);
    const input = await body(c);
    if (input instanceof Response) return input;
    try {
      return c.json({ card: await board.add(input) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/api/prospection/cartes/:id/deplacer", async (c) => {
    if (board === undefined) return absent(c);
    const id = c.req.param("id");
    if (!CARD_ID_RULE.test(id)) return c.json({ error: "unknown card" }, 404);
    const input = await body(c);
    if (input instanceof Response) return input;
    try {
      await board.move(Number(id), input.colonne);
      return c.json({ ok: true });
    } catch (error) {
      return failure(c, error);
    }
  });
}
