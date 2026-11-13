// The model's calls never follow a redirect (lot F5, 13/11): the address is
// this machine, but a local server answering 3xx would lead a mail's content
// elsewhere. Real HTTP servers on 127.0.0.1: the redirect's target never
// receives a request.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createLocalModels, noRedirect } from "./local-model.ts";

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler).listen(0, "127.0.0.1", () => resolve(server));
  });
}
const port = (s: Server) => (s.address() as AddressInfo).port;

describe("never a redirect", () => {
  it("noRedirect fails on a 307 and the target is never reached", async () => {
    let reached = 0;
    const target = await listen((_req, res) => {
      reached++;
      res.end("{}");
    });
    const relay = await listen((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${port(target)}/v1/chat/completions` });
      res.end();
    });
    try {
      await expect(
        noRedirect(`http://127.0.0.1:${port(relay)}/v1/chat/completions`, {
          method: "POST",
          body: "{}",
        }),
      ).rejects.toThrow();
      expect(reached).toBe(0);
    } finally {
      relay.close();
      target.close();
    }
  });

  it("a call to the local model through createLocalModels does not follow one either", async () => {
    let reached = 0;
    const target = await listen((_req, res) => {
      reached++;
      res.end("{}");
    });
    const relay = await listen((_req, res) => {
      res.writeHead(308, { location: `http://127.0.0.1:${port(target)}/v1/chat/completions` });
      res.end();
    });
    try {
      const local = createLocalModels({
        baseUrl: `http://127.0.0.1:${port(relay)}/v1`,
        modelId: "fictive",
      });
      const stream = local.models.streamSimple(local.model, {
        messages: [{ role: "user", content: "Bonjour", timestamp: 0 }],
      } as never);
      const events: string[] = [];
      for await (const e of stream) events.push(e.type);
      expect(events.at(-1)).toBe("error");
      expect(reached).toBe(0);
    } finally {
      relay.close();
      target.close();
    }
  });

  it("an answer without redirect still goes through", async () => {
    const ok = await listen((_req, res) => res.end("fine"));
    try {
      const r = await noRedirect(`http://127.0.0.1:${port(ok)}/`);
      expect(await r.text()).toBe("fine");
    } finally {
      ok.close();
    }
  });
});
