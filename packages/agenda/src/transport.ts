/**
 * The CalDAV client's only way out (ADR-0042, point 3). It knows two methods,
 * PROPFIND and REPORT: it cannot write in a calendar, and a test reads this
 * code to say so.
 *
 * HTTPS only, the certificate always checked; no redirection followed (one is
 * a failure, said as such); 8 MiB at most per answer, 30 s at most per
 * request, idle or not. Before anything is sent, the address — as resolved,
 * so `//other-host/…` counts — must name an admitted host: the password never
 * leaves for another one.
 */
import { request } from "node:https";

export type Method = "PROPFIND" | "REPORT";

export interface DavRequest {
  readonly method: Method;
  readonly url: URL;
  readonly depth: "0" | "1";
  readonly body: string;
}

export interface Credentials {
  readonly login: string;
  readonly password: string;
  /** `host[:port]` as a URL names it. */
  readonly admitted: ReadonlySet<string>;
}

/** What a request gives: the answer, or the word for its failure. */
export type Answer =
  | { readonly status: number; readonly body: string }
  | "refus"
  | "injoignable"
  | "delai"
  | "illisible"
  | "hote";

export interface SendOptions {
  /** The whole account's deadline: aborting it ends the request as "delai". */
  readonly signal?: AbortSignal;
  /** For tests only: an authority to trust, never a check turned off. */
  readonly ca?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export const TIMEOUT_MS = 30_000;
export const MAX_BYTES = 8 * 1024 * 1024;

/** True when the password may go to this address. */
export function admits(credentials: Credentials, url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    credentials.admitted.has(url.host)
  );
}

export function send(
  req: DavRequest,
  credentials: Credentials,
  options: SendOptions = {},
): Promise<Answer> {
  if (req.method !== "PROPFIND" && req.method !== "REPORT") return Promise.resolve("illisible");
  if (!admits(credentials, req.url)) return Promise.resolve("hote");
  if (options.signal?.aborted === true) return Promise.resolve("delai");
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const body = Buffer.from(req.body, "utf8");
  const auth = Buffer.from(`${credentials.login}:${credentials.password}`, "utf8").toString(
    "base64",
  );
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: Answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(answer);
    };
    const r = request(
      {
        protocol: "https:",
        hostname: req.url.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: req.url.port === "" ? 443 : Number(req.url.port),
        path: `${req.url.pathname}${req.url.search}`,
        method: req.method,
        rejectUnauthorized: true,
        ...(options.ca === undefined ? {} : { ca: options.ca }),
        agent: false,
        timeout: timeoutMs,
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/xml; charset=utf-8",
          "content-length": String(body.length),
          depth: req.depth,
          "user-agent": "cenacle-agenda",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          // A redirection is a failure, never followed.
          res.destroy();
          return finish("injoignable");
        }
        if (status === 401 || status === 403) {
          res.destroy();
          return finish("refus");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            finish("illisible");
          } else chunks.push(chunk);
        });
        res.on("end", () => finish({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => finish("injoignable"));
      },
    );
    // An idle limit is not a deadline: a server dripping bytes is cut here too.
    const deadline = setTimeout(() => {
      finish("delai");
      r.destroy();
    }, timeoutMs);
    const onAbort = () => {
      finish("delai");
      r.destroy();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    r.on("timeout", () => {
      finish("delai");
      r.destroy();
    });
    // A certificate that does not match lands here: nothing was sent.
    r.on("error", () => finish("injoignable"));
    r.end(body);
  });
}
