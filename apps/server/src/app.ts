/**
 * HTTP API. Bound to 127.0.0.1 by main.ts; reachable from elsewhere only
 * through Tailscale later (ADR-0006). The status stream carries counters
 * only; the proposals need the token (see guard.ts).
 */
import { ProposalError } from "@cenacle/journal";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { type GuardConfig, hostGuard, tokenGuard } from "./guard.ts";
import type { ProposalsService } from "./proposals-service.ts";
import { type ReadAfter, watchAgent } from "./watch.ts";

const AGENT_RULE = /^[a-z][a-z0-9_-]{0,31}$/;
const PROPOSAL_ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 16 * 1024;

export interface AppDeps {
  readonly readAfter: ReadAfter;
  readonly guard: GuardConfig;
  readonly proposals: ProposalsService;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("/api/*", hostGuard(deps.guard));
  app.use("/api/proposals", tokenGuard(deps.guard));
  app.use("/api/proposals/*", tokenGuard(deps.guard));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/agents/:agent/stream", (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_RULE.test(agent)) return c.json({ error: "unknown agent" }, 404);
    return streamSSE(c, async (stream) => {
      await watchAgent({
        agent,
        readAfter: deps.readAfter,
        send: (message) => stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }),
        sleep: async (ms) => {
          await stream.sleep(ms);
        },
        isClosed: () => stream.aborted || stream.closed,
      });
    });
  });

  app.get("/api/proposals", async (c) => c.json({ proposals: await deps.proposals.list() }));

  const action =
    (run: (id: string, body: Record<string, unknown>) => Promise<void>) => async (c: Context) => {
      const id = c.req.param("id") ?? "";
      if (!PROPOSAL_ID_RULE.test(id)) return c.json({ error: "unknown proposal" }, 404);
      const raw = await c.req.text();
      if (raw.length > MAX_BODY) return c.json({ error: "too large" }, 413);
      let body: unknown = {};
      try {
        body = raw.length === 0 ? {} : JSON.parse(raw);
      } catch {
        return c.json({ error: "invalid JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "invalid body" }, 400);
      }
      try {
        await run(id, body as Record<string, unknown>);
      } catch (error) {
        // A refused transition is expected (double click, delay over…): say why.
        if (error instanceof ProposalError) return c.json({ error: error.message }, 409);
        return c.json({ error: "internal error" }, 500);
      }
      return c.json({ ok: true });
    };

  app.put(
    "/api/proposals/:id/draft",
    action((id, body) => deps.proposals.edit(id, body.draft)),
  );
  app.post(
    "/api/proposals/:id/accept",
    action((id) => deps.proposals.accept(id)),
  );
  app.post(
    "/api/proposals/:id/refuse",
    action((id) => deps.proposals.refuse(id)),
  );
  app.post(
    "/api/proposals/:id/cancel",
    action((id) => deps.proposals.cancel(id)),
  );

  return app;
}
