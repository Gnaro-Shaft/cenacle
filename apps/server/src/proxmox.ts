/**
 * The Proxmox cluster, read-only, for the Parc tab (ADR-0039): a token of a
 * dedicated user with the PVEAuditor role alone (it sees, it changes
 * nothing), in .env.proxmox, the page's server's alone. Over HTTPS with the
 * certificate always checked — against the cluster's own authority, pinned
 * by its file (CENACLE_PROXMOX_CA), the node's name as the name checked: never
 * a check turned off. A short time limit, a capped answer, one reading at a
 * time, kept 30 s; nothing kept beyond that.
 *
 * The nodes are tried in turn: one down, the other still answers for the
 * cluster. None answering: "injoignable" — never shown healthy.
 */
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { type ProxmoxDisk, type ProxmoxNode, parseDisks, parseResources } from "./proxmox-parse.ts";

const TIMEOUT_MS = 8_000;
const MAX_ANSWER = 1024 * 1024;
const KEEP_MS = 30_000;
const TOKEN_RULE = /^[a-z0-9._-]{1,64}@[a-z0-9.-]{1,32}![A-Za-z0-9._-]{1,64}=[0-9a-f-]{36}$/;
const ENDPOINT_RULE = /^([A-Za-z0-9][A-Za-z0-9-]{0,62})@([a-z0-9.-]{1,253}):(\d{2,5})$/;

export interface ProxmoxEndpoint {
  /** The node's name: the name its certificate carries, checked as such. */
  readonly node: string;
  readonly host: string;
  readonly port: number;
}

export interface ProxmoxConfig {
  readonly endpoints: readonly ProxmoxEndpoint[];
  readonly ca: string;
  readonly token: string;
}

export type ProxmoxView =
  | { readonly read: "absent" | "config" | "injoignable" | "refuse" | "illisible" }
  | {
      readonly read: "ok";
      readonly nodes: readonly (ProxmoxNode & { readonly disks: readonly ProxmoxDisk[] | null })[];
    };

/**
 * The configuration from the environment: absent when nothing is set (no
 * Proxmox to read), "config" when it is set but wrong — never a value said.
 */
export function proxmoxConfig(
  env: NodeJS.ProcessEnv,
  readCa: (path: string) => string = (p) => readFileSync(p, "utf8"),
): ProxmoxConfig | "absent" | "config" {
  const nodes = env.CENACLE_PROXMOX_NODES ?? "";
  const caPath = env.CENACLE_PROXMOX_CA ?? "";
  const token = env.CENACLE_PROXMOX_TOKEN ?? "";
  if (nodes === "" && caPath === "" && token === "") return "absent";
  if (!TOKEN_RULE.test(token) || !caPath.startsWith("/")) return "config";
  const endpoints: ProxmoxEndpoint[] = [];
  for (const part of nodes.split(",").map((p) => p.trim())) {
    const m = ENDPOINT_RULE.exec(part);
    const port = Number(m?.[3]);
    if (m === null || port < 1 || port > 65535) return "config";
    endpoints.push({ node: m[1] ?? "", host: m[2] ?? "", port });
  }
  if (endpoints.length === 0 || endpoints.length > 8) return "config";
  let ca: string;
  try {
    ca = readCa(caPath);
  } catch {
    return "config";
  }
  if (!ca.includes("BEGIN CERTIFICATE")) return "config";
  return { endpoints, ca, token };
}

export type Answer =
  | { readonly status: number; readonly body: unknown }
  | "unreachable"
  | "garbled";

/** One GET, the certificate checked; the token goes in a header, never in an address. */
export function getJson(config: ProxmoxConfig, at: ProxmoxEndpoint, path: string): Promise<Answer> {
  return new Promise((resolve) => {
    let size = 0;
    const req = request(
      {
        host: at.host,
        port: at.port,
        path: `/api2/json${path}`,
        method: "GET",
        ca: config.ca,
        servername: at.node,
        rejectUnauthorized: true,
        timeout: TIMEOUT_MS,
        headers: { authorization: `PVEAPIToken=${config.token}`, accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ANSWER) {
            res.destroy();
            resolve("garbled");
          } else chunks.push(chunk);
        });
        res.on("end", () => {
          if (size > MAX_ANSWER) return;
          const status = res.statusCode ?? 0;
          if (status === 401 || status === 403) return resolve({ status, body: null });
          try {
            resolve({ status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve("garbled");
          }
        });
        res.on("error", () => resolve(size > MAX_ANSWER ? "garbled" : "unreachable"));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    // An idle limit is not a deadline: a peer dripping bytes is cut here.
    const deadline = setTimeout(() => req.destroy(new Error("deadline")), TIMEOUT_MS * 2);
    req.on("close", () => clearTimeout(deadline));
    // A certificate that does not match lands here too: no answer, never a request sent.
    req.on("error", () => resolve("unreachable"));
    req.end();
  });
}

export interface ProxmoxDeps {
  readonly config: () => ProxmoxConfig | "absent" | "config";
  readonly get: (config: ProxmoxConfig, at: ProxmoxEndpoint, path: string) => Promise<Answer>;
  readonly now: () => number;
}

async function withDisks(
  deps: ProxmoxDeps,
  config: ProxmoxConfig,
  at: ProxmoxEndpoint,
  n: ProxmoxNode,
): Promise<ProxmoxNode & { readonly disks: readonly ProxmoxDisk[] | null }> {
  if (!n.online) return { ...n, disks: null };
  const answer = await deps.get(config, at, `/nodes/${encodeURIComponent(n.name)}/disks/list`);
  if (typeof answer === "string" || answer.status !== 200) return { ...n, disks: null };
  try {
    return { ...n, disks: parseDisks(answer.body) };
  } catch {
    return { ...n, disks: null };
  }
}

async function readCluster(deps: ProxmoxDeps): Promise<ProxmoxView> {
  const config = deps.config();
  if (config === "absent" || config === "config") return { read: config };
  let worst: "injoignable" | "illisible" = "injoignable";
  for (const at of config.endpoints) {
    const answer = await deps.get(config, at, "/cluster/resources");
    if (answer === "unreachable") continue;
    if (answer === "garbled") {
      worst = "illisible";
      continue;
    }
    if (answer.status === 401 || answer.status === 403) return { read: "refuse" };
    let nodes: ProxmoxNode[];
    try {
      if (answer.status !== 200) throw new Error("status");
      nodes = parseResources(answer.body);
    } catch {
      worst = "illisible";
      continue;
    }
    return {
      read: "ok",
      nodes: await Promise.all(nodes.map((n) => withDisks(deps, config, at, n))),
    };
  }
  return { read: worst };
}

export function createProxmox(deps: ProxmoxDeps): () => Promise<ProxmoxView> {
  let kept: { at: number; view: Promise<ProxmoxView> } | null = null;
  return () => {
    const now = deps.now();
    if (kept === null || now - kept.at > KEEP_MS) kept = { at: now, view: readCluster(deps) };
    return kept.view;
  };
}
