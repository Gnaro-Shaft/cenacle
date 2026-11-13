/**
 * HTTP API. Bound to 127.0.0.1 by main.ts; reachable from elsewhere only
 * through Tailscale later (ADR-0006). The status stream carries states and
 * counters only, never mail content (ADR-0005), so it stays open without the
 * token: an EventSource cannot send a header, and the token never goes in a
 * URL. A test pins the keys it may carry. The proposals and the CTO need the
 * token (see guard.ts).
 */
import { type CtoReply, CtoServiceError, QuestionError, validQuestion } from "@cenacle/cto";
import { ProposalError } from "@cenacle/journal";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { type ApiLog, internalLine, streamLine } from "./api-log.ts";
import { type GuardConfig, hostGuard, tokenGuard } from "./guard.ts";
import type { ProposalsService } from "./proposals-service.ts";
import { mountProspection } from "./prospection-routes.ts";
import type { ProspectionService } from "./prospection-service.ts";
import { type ReadAfter, watchAgent, watchAgents } from "./watch.ts";

const AGENT_RULE = /^[a-z][a-z0-9_-]{0,31}$/;
/** The team the page follows on one stream: at most this many agents. */
export const MAX_TEAM = 12;
const PROPOSAL_ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 16 * 1024;

export interface AppDeps {
  readonly readAfter: ReadAfter;
  readonly guard: GuardConfig;
  readonly proposals: ProposalsService;
  /** Asks the CTO's service (ADR-0020); absent, the route says so. */
  readonly askCto?: (question: string) => Promise<CtoReply>;
  /** The board of missions (ADR-0032); absent, its routes say so. */
  readonly prospection?: ProspectionService;
  /** Where a 500 or a broken stream is said in one line (api-log.ts); the console by default. */
  readonly log?: ApiLog;
}

/** What the page is told when the CTO cannot answer: a status and a short reason. */
function ctoFailure(error: unknown): { status: 400 | 502 | 503 | 504; message: string } {
  if (error instanceof QuestionError) return { status: 400, message: error.message };
  if (error instanceof CtoServiceError) {
    if (error.code === "invalid") return { status: 400, message: error.message };
    if (error.code === "timeout") return { status: 504, message: error.message };
    if (
      error.code === "busy" ||
      error.code === "unreachable" ||
      error.code === "model_unavailable"
    ) {
      return { status: 503, message: error.message };
    }
  }
  return { status: 502, message: "le CTO n'a pas pu répondre" };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? ((line: string) => console.error(line));
  // Whatever a route did not catch: one line, then the same silent 500.
  app.onError((error, c) => {
    // An answer thrown on purpose (a 401, a body too large) keeps its own status.
    if (error instanceof HTTPException) return error.getResponse();
    log(internalLine(c, error));
    return c.json({ error: "internal error" }, 500);
  });
  app.use("/api/*", hostGuard(deps.guard));
  app.use("/api/proposals", tokenGuard(deps.guard));
  app.use("/api/proposals/*", tokenGuard(deps.guard));
  app.use("/api/cto", tokenGuard(deps.guard));
  app.use("/api/prospection", tokenGuard(deps.guard));
  app.use("/api/prospection/*", tokenGuard(deps.guard));

  app.get("/api/health", (c) => c.json({ ok: true }));
  mountProspection(app, deps.prospection, log);

  // The whole team on one stream (?agents=iris,cto,…): one connection, not one per card.
  app.get("/api/agents/stream", (c) => {
    const agents = (c.req.query("agents") ?? "").split(",");
    if (
      agents.length > MAX_TEAM ||
      new Set(agents).size !== agents.length ||
      !agents.every((agent) => AGENT_RULE.test(agent))
    ) {
      return c.json({ error: "unknown agent" }, 404);
    }
    const broken = async (error: Error) => log(streamLine(c, error));
    return streamSSE(
      c,
      async (stream) => {
        await watchAgents({
          agents,
          readAfter: deps.readAfter,
          send: (message) =>
            stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }),
          sleep: async (ms) => {
            await stream.sleep(ms);
          },
          isClosed: () => stream.aborted || stream.closed,
        });
      },
      broken,
    );
  });

  app.get("/api/agents/:agent/stream", (c) => {
    const agent = c.req.param("agent");
    if (!AGENT_RULE.test(agent)) return c.json({ error: "unknown agent" }, 404);
    const broken = async (error: Error) => log(streamLine(c, error));
    return streamSSE(
      c,
      async (stream) => {
        await watchAgent({
          agent,
          readAfter: deps.readAfter,
          send: (message) =>
            stream.writeSSE({ event: message.kind, data: JSON.stringify(message) }),
          sleep: async (ms) => {
            await stream.sleep(ms);
          },
          isClosed: () => stream.aborted || stream.closed,
        });
      },
      broken,
    );
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
        log(internalLine(c, error));
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
    action((id, body) => deps.proposals.accept(id, body.draft)),
  );
  app.post(
    "/api/proposals/:id/refuse",
    action((id) => deps.proposals.refuse(id)),
  );
  app.post(
    "/api/proposals/:id/cancel",
    action((id) => deps.proposals.cancel(id)),
  );

  // The CTO (ADR-0020): the question goes to his service, the checked answer
  // comes back; nothing is kept here either.
  app.post("/api/cto", async (c) => {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY) return c.json({ error: "too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "invalid body" }, 400);
    }
    if (deps.askCto === undefined) return c.json({ error: "le CTO n'est pas branché" }, 503);
    try {
      const question = validQuestion((body as Record<string, unknown>).question);
      return c.json({ reply: await deps.askCto(question) });
    } catch (error) {
      const failure = ctoFailure(error);
      if (failure.status === 502) log(internalLine(c, error));
      return c.json({ error: failure.message }, failure.status);
    }
  });

  return app;
}
