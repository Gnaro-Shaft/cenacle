/** Test doubles: an in-memory journal and a fake OpenAI-compatible server. */
import { createServer, type Server } from "node:http";
import type { Journal, NewEvent, StoredEvent } from "@cenacle/journal";

export function memoryJournal(): Journal & { events: StoredEvent[] } {
  const events: StoredEvent[] = [];
  return {
    events,
    async append(event: NewEvent) {
      const stored: StoredEvent = {
        id: BigInt(events.length + 1),
        occurredAt: new Date(),
        agent: event.agent,
        type: event.type,
        payload: event.payload ?? {},
      };
      events.push(stored);
      return stored;
    },
    async read() {
      return [...events];
    },
  };
}

export interface FakeModelServer {
  readonly baseUrl: string;
  readonly requests: string[];
  close(): Promise<void>;
}

/** Answers every chat completion with `reply` (or `reply(requestBody)`), streamed in two chunks. */
export async function fakeModelServer(
  replyWith: string | ((body: string) => string),
): Promise<FakeModelServer> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(body);
      const reply = typeof replyWith === "string" ? replyWith : replyWith(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: object, finish: string | null) =>
        res.write(
          `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      const half = Math.ceil(reply.length / 2);
      send({ role: "assistant", content: reply.slice(0, half) }, null);
      send({ content: reply.slice(half) }, "stop");
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
