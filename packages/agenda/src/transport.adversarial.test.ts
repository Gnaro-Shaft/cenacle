// The CalDAV client's way out (ADR-0042, point 3), against a real local HTTPS
// server: it can only read (a test reads the code), the certificate is always
// checked, the password goes to an admitted host only — never to an address
// the answer hands over (`//other-host/…`, a neighbouring IP, a host sharing a
// suffix, plain HTTP) — and a redirection, an answer too large or too slow,
// a refusal are each said by their word.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { discover } from "./releve.ts";
import { type Credentials, type DavRequest, send } from "./transport.ts";

const DIR = mkdtempSync(join(tmpdir(), "agenda-test-"));
const sh = (args: string[]) => execFileSync("openssl", args, { cwd: DIR, stdio: "ignore" });
const PASSWORD = "pw-1234";

/** An authority, and a certificate it signs for 127.0.0.1. */
function pki(tag: string) {
  const key = (f: string) => ["-newkey", "rsa:2048", "-nodes", "-keyout", f];
  sh([
    "req",
    "-x509",
    ...key(`${tag}-ca.key`),
    "-out",
    `${tag}-ca.pem`,
    "-days",
    "2",
    "-subj",
    `/CN=${tag} CA`,
  ]);
  sh(["req", ...key(`${tag}.key`), "-out", `${tag}.csr`, "-subj", "/CN=127.0.0.1"]);
  writeFileSync(join(DIR, `${tag}.ext`), "subjectAltName=IP:127.0.0.1\n");
  sh([
    "x509",
    "-req",
    "-in",
    `${tag}.csr`,
    "-CA",
    `${tag}-ca.pem`,
    "-CAkey",
    `${tag}-ca.key`,
    "-CAcreateserial",
    "-out",
    `${tag}.pem`,
    "-days",
    "2",
    "-extfile",
    `${tag}.ext`,
  ]);
  const read = (f: string) => readFileSync(join(DIR, f), "utf8");
  return { ca: read(`${tag}-ca.pem`), key: read(`${tag}.key`), cert: read(`${tag}.pem`) };
}

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly auth: string | undefined;
  readonly depth: string | undefined;
}
const seen: Seen[] = [];
type Reply = (path: string, res: import("node:http").ServerResponse) => void;
const multistatus = (inner: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${inner}</d:multistatus>`;
let reply: Reply = (_, res) => {
  res.writeHead(207, { "content-type": "application/xml" });
  res.end(multistatus(""));
};

let good: ReturnType<typeof pki>;
let foreign: ReturnType<typeof pki>;
const servers: Server[] = [];
function serve(of: ReturnType<typeof pki>): Promise<number> {
  const server = createServer({ key: of.key, cert: of.cert }, (req, res) => {
    seen.push({
      method: req.method ?? "",
      path: req.url ?? "",
      auth: req.headers.authorization,
      depth: req.headers.depth as string | undefined,
    });
    req.resume();
    req.on("end", () => reply(req.url ?? "", res));
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

let port = 0;
let foreignPort = 0;
beforeAll(async () => {
  good = pki("good");
  foreign = pki("foreign");
  port = await serve(good);
  foreignPort = await serve(foreign);
}, 60_000);
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  rmSync(DIR, { recursive: true, force: true });
});
beforeEach(() => {
  seen.length = 0;
  reply = (_, res) => {
    res.writeHead(207, { "content-type": "application/xml" });
    res.end(multistatus(""));
  };
});

const creds = (): Credentials => ({
  login: "moi@exemple.test",
  password: PASSWORD,
  admitted: new Set([`127.0.0.1:${port}`]),
});
const req = (url: string): DavRequest => ({
  method: "PROPFIND",
  url: new URL(url),
  depth: "0",
  body: "<x/>",
});
const opts = () => ({ ca: good.ca, timeoutMs: 2000 });

describe("the client can only read: a test reads the code", () => {
  const dir = import.meta.dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);

  it("no method of writing is named anywhere in the package's code", () => {
    expect(sources.length).toBeGreaterThan(5);
    const verbs = ["PUT", "POST", "DELETE", "PATCH", "PROPPATCH", "MKCOL", "MKCALENDAR"];
    for (const [file, text] of sources) {
      for (const verb of [...verbs, "MOVE", "COPY", "LOCK", "UNLOCK"]) {
        expect(new RegExp(`["'\`]${verb}["'\`]`).test(text), `${verb} in ${file}`).toBe(false);
      }
    }
  });

  it("the transport sends PROPFIND and REPORT only, and refuses any other at run time", async () => {
    const transport = sources.find(([f]) => f === "transport.ts")?.[1] ?? "";
    expect(transport).toContain('export type Method = "PROPFIND" | "REPORT";');
    const forged = {
      ...req(`https://127.0.0.1:${port}/`),
      method: "DELETE",
    } as unknown as DavRequest;
    expect(await send(forged, creds(), opts())).toBe("illisible");
    expect(seen).toEqual([]);
  });

  it("the certificate check is never turned off", () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/rejectUnauthorized:\s*false/);
      expect(text, file).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    }
  });
});

describe("the password goes to an admitted host only", () => {
  it("an admitted host gets the request, with the password in a header and the depth said", async () => {
    const answer = await send(req(`https://127.0.0.1:${port}/dav/`), creds(), opts());
    expect(answer).toMatchObject({ status: 207 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("PROPFIND");
    expect(seen[0]?.depth).toBe("0");
    expect(Buffer.from(seen[0]?.auth?.replace("Basic ", "") ?? "", "base64").toString()).toBe(
      `moi@exemple.test:${PASSWORD}`,
    );
  });

  it.each([
    ["plain HTTP", (p: number) => `http://127.0.0.1:${p}/`],
    ["a neighbouring IP", (p: number) => `https://127.0.0.2:${p}/`],
    ["the same host on another port", (p: number) => `https://127.0.0.1:${p + 1}/`],
    ["a host sharing a suffix", () => "https://evil127.0.0.1.exemple.test/"],
    ["a login in the address", (p: number) => `https://x:y@127.0.0.1:${p}/`],
  ])("%s: refused before anything is sent", async (_, url) => {
    expect(await send(req(url(port)), creds(), opts())).toBe("hote");
    expect(seen).toEqual([]);
  });

  it("an address handed over by the answer as //other-host/… is never asked", async () => {
    reply = (_, res) => {
      res.writeHead(207, { "content-type": "application/xml" });
      res.end(
        multistatus(
          "<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>//autre-hote.exemple.test/p/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>",
        ),
      );
    };
    const c = creds();
    const result = await discover(
      (r) => send(r, c, opts()),
      new URL(`https://127.0.0.1:${port}/`),
      new Set(),
    );
    expect(result).toBe("hote");
    expect(seen).toHaveLength(1); // the first request only; the other host never asked
  });

  it("a certificate from another authority: nothing is sent", async () => {
    const c = { ...creds(), admitted: new Set([`127.0.0.1:${foreignPort}`]) };
    expect(await send(req(`https://127.0.0.1:${foreignPort}/`), c, opts())).toBe("injoignable");
    expect(seen).toEqual([]);
  });

  it("without the test's authority, the system's own is used: the test server is not trusted", async () => {
    expect(await send(req(`https://127.0.0.1:${port}/`), creds(), { timeoutMs: 2000 })).toBe(
      "injoignable",
    );
    expect(seen).toEqual([]);
  });
});

describe("each failure has its word", () => {
  it("a redirection is a failure, never followed", async () => {
    reply = (_, res) => {
      res.writeHead(301, { location: `https://127.0.0.1:${port}/ailleurs` });
      res.end();
    };
    expect(await send(req(`https://127.0.0.1:${port}/`), creds(), opts())).toBe("injoignable");
    expect(seen).toHaveLength(1);
  });

  it.each([401, 403])("%i: refus", async (status) => {
    reply = (_, res) => {
      res.writeHead(status);
      res.end("<html>nope</html>");
    };
    expect(await send(req(`https://127.0.0.1:${port}/`), creds(), opts())).toBe("refus");
  });

  it("an answer beyond the bound: illisible", async () => {
    reply = (_, res) => {
      res.writeHead(207);
      res.end("x".repeat(70_000));
    };
    const answer = await send(req(`https://127.0.0.1:${port}/`), creds(), {
      ...opts(),
      maxBytes: 64_000,
    });
    expect(answer).toBe("illisible");
  });

  it("a server dripping bytes past the deadline: delai", async () => {
    reply = (_, res) => {
      res.writeHead(207);
      const drip = setInterval(() => res.write("x"), 50);
      res.on("close", () => clearInterval(drip));
    };
    const started = Date.now();
    const answer = await send(req(`https://127.0.0.1:${port}/`), creds(), {
      ...opts(),
      timeoutMs: 400,
    });
    expect(answer).toBe("delai");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("the account's deadline aborts a request under way: delai", async () => {
    reply = () => {}; // never answers
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const answer = await send(req(`https://127.0.0.1:${port}/`), creds(), {
      ...opts(),
      signal: controller.signal,
    });
    expect(answer).toBe("delai");
  });
});
