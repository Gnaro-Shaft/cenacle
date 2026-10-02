/**
 * HTTP API. Bound to 127.0.0.1 by main.ts; reachable from elsewhere only
 * through Tailscale later (ADR-0006).
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { type ReadAfter, watchAgent } from "./watch.ts";

const AGENT_RULE = /^[a-z][a-z0-9_-]{0,31}$/;

export function createApp(readAfter: ReadAfter): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/agents/:agent/stream", (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_RULE.test(agent)) return c.json({ error: "unknown agent" }, 404);
    return streamSSE(c, async (stream) => {
      await watchAgent({
        agent,
        readAfter,
        send: (message) => stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }),
        sleep: async (ms) => {
          await stream.sleep(ms);
        },
        isClosed: () => stream.aborted || stream.closed,
      });
    });
  });

  return app;
}
