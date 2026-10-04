/**
 * The sentinel's door (phase 5, S2): one route, POST /battement, behind a
 * token. Bound to the VPS's Tailscale address only (main.ts). It answers no
 * question about the Mac: it only listens. node:http, no dependency.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { BeatError, parseBeat, type Watch } from "./watch.ts";

const MAX_BODY = 1024;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandler(deps: {
  readonly token: string;
  readonly watch: Watch;
  readonly now: () => Date;
}) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const end = (status: number) => {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end();
    };
    if (req.method !== "POST" || req.url !== "/battement") {
      end(404);
      return;
    }
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!sameSecret(given, deps.token)) {
      end(401);
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      end(415);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        end(413);
        return;
      }
      try {
        deps.watch.beat(parseBeat(JSON.parse(Buffer.concat(chunks).toString("utf8")), deps.now()));
        end(204);
      } catch (error) {
        end(error instanceof BeatError || error instanceof SyntaxError ? 400 : 500);
      }
    });
  };
}
