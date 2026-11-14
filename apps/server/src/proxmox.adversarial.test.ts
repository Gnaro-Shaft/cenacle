// The Proxmox cluster, read-only (ADR-0039), against a real local HTTPS server
// playing a node: the certificate always checked against the cluster's own
// authority and the node's name — a foreign certificate gets no request at
// all; the token in a header, never in an address; refused, garbled, too
// large or down said as such; the next node tried; only the shown fields
// come out.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProxmox,
  getJson,
  type ProxmoxConfig,
  type ProxmoxEndpoint,
  proxmoxConfig,
} from "./proxmox.ts";
import { parseDisks, parseResources } from "./proxmox-parse.ts";

const DIR = mkdtempSync(join(tmpdir(), "proxmox-test-"));
const TOKEN = "cenacle@pve!parc=0b5c3a8e-1111-4c2d-9e3f-123456789abc";
const sh = (args: string[]) => execFileSync("openssl", args, { cwd: DIR, stdio: "ignore" });

/** An authority, and a certificate it signs for `name`. */
function pki(tag: string, name: string) {
  sh([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${tag}-ca.key`,
    "-out",
    `${tag}-ca.pem`,
    "-days",
    "2",
    "-subj",
    `/CN=${tag} CA`,
  ]);
  sh([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${tag}.key`,
    "-out",
    `${tag}.csr`,
    "-subj",
    `/CN=${name}`,
  ]);
  writeFileSync(join(DIR, `${tag}.ext`), `subjectAltName=DNS:${name}\n`);
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

const RESOURCES = {
  data: [
    {
      type: "node",
      node: "alpha",
      status: "online",
      cpu: 0.011,
      mem: 4e9,
      maxmem: 16e9,
      uptime: 3600,
    },
    {
      type: "qemu",
      vmid: 102,
      name: "docker-1",
      node: "alpha",
      status: "running",
      cpu: 0.02,
      mem: 1e9,
      maxmem: 2e9,
      hidden: "never-passed-on",
    },
    {
      type: "lxc",
      vmid: 101,
      name: "nut",
      node: "alpha",
      status: "stopped",
      cpu: 0,
      mem: 0,
      maxmem: 5e8,
    },
    { type: "storage", storage: "local", node: "alpha", disk: 1, maxdisk: 2 },
  ],
};
const DISKS = {
  data: [
    { devpath: "/dev/sda", model: "Samsung SSD 870", type: "ssd", wearout: 89, health: "PASSED" },
  ],
};

let cluster: ReturnType<typeof pki>;
let foreign: ReturnType<typeof pki>;
const seen: { path: string; auth: string | undefined }[] = [];
const normal = (path: string) =>
  path.endsWith("/disks/list")
    ? { status: 200, body: JSON.stringify(DISKS) }
    : { status: 200, body: JSON.stringify(RESOURCES) };
let answer: (path: string) => { status: number; body: string } = normal;
const servers: Server[] = [];

function serve(pkiOf: ReturnType<typeof pki>): Promise<number> {
  const server = createServer({ key: pkiOf.key, cert: pkiOf.cert }, (req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization });
    const a = answer(req.url ?? "");
    res.writeHead(a.status, { "content-type": "application/json" });
    res.end(a.body);
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

let goodPort = 0;
let foreignPort = 0;
beforeAll(async () => {
  cluster = pki("cluster", "alpha");
  foreign = pki("foreign", "alpha");
  goodPort = await serve(cluster);
  foreignPort = await serve(foreign);
}, 60_000);
afterAll(() => {
  for (const s of servers) s.close();
  rmSync(DIR, { recursive: true, force: true });
});

const config = (endpoints: ProxmoxEndpoint[]): ProxmoxConfig => ({
  endpoints,
  ca: cluster.ca,
  token: TOKEN,
});
const at = (port: number, node = "alpha"): ProxmoxEndpoint => ({ node, host: "127.0.0.1", port });

describe("the certificate, always checked", () => {
  it("signed by the cluster's authority for this node: read", async () => {
    seen.length = 0;
    const a = await getJson(config([at(goodPort)]), at(goodPort), "/cluster/resources");
    expect(a).toMatchObject({ status: 200 });
    // The token in its header, never in the address.
    expect(seen[0]?.auth).toBe(`PVEAPIToken=${TOKEN}`);
    expect(seen[0]?.path).toBe("/api2/json/cluster/resources");
  });

  it("signed by another authority: unreachable, and not one request reaches it", async () => {
    seen.length = 0;
    const a = await getJson(config([at(foreignPort)]), at(foreignPort), "/cluster/resources");
    expect(a).toBe("unreachable");
    expect(seen).toEqual([]);
  });

  it("the cluster's certificate, but for another node's name: unreachable, no request", async () => {
    seen.length = 0;
    const beta = at(goodPort, "beta");
    expect(await getJson(config([beta]), beta, "/cluster/resources")).toBe("unreachable");
    expect(seen).toEqual([]);
  });
});

describe("the cluster, as the page gets it", () => {
  const read = (endpoints: ProxmoxEndpoint[]) =>
    createProxmox({ config: () => config(endpoints), get: getJson, now: () => 0 })();

  it("nodes, guests sorted, disks — and nothing the page does not show", async () => {
    const view = await read([at(goodPort)]);
    expect(view).toMatchObject({ read: "ok" });
    if (view.read !== "ok") return;
    expect(view.nodes[0]).toMatchObject({
      name: "alpha",
      online: true,
      cpuPercent: 1,
      uptimeSeconds: 3600,
    });
    expect(view.nodes[0]?.guests.map((g) => [g.id, g.kind, g.running])).toEqual([
      [101, "ct", false],
      [102, "vm", true],
    ]);
    expect(view.nodes[0]?.disks?.[0]).toMatchObject({
      device: "/dev/sda",
      wearLeft: 89,
      healthy: true,
    });
    expect(JSON.stringify(view)).not.toContain("never-passed-on");
    expect(JSON.stringify(view)).not.toContain("storage");
  });

  it("the first node down: the next one answers for the cluster", async () => {
    expect((await read([at(1), at(goodPort)])).read).toBe("ok");
  });

  it.each([
    ["refused (a revoked token)", { status: 401, body: "" }, "refuse"],
    ["an error page", { status: 500, body: "<html>" }, "illisible"],
    ["not JSON", { status: 200, body: "<html>" }, "illisible"],
    [
      "out of shape",
      { status: 200, body: JSON.stringify({ data: [{ type: "qemu" }] }) },
      "illisible",
    ],
    ["far too large", { status: 200, body: `{"data":[${"0,".repeat(700_000)}0]}` }, "illisible"],
  ])("%s: said as %s", async (_what, reply, expected) => {
    answer = () => reply;
    try {
      expect((await read([at(goodPort)])).read).toBe(expected);
    } finally {
      answer = normal;
    }
  });

  it("no node answering: unreachable, never healthy", async () => {
    expect((await read([at(1), at(foreignPort)])).read).toBe("injoignable");
  });

  it("one reading at a time, kept 30 s", async () => {
    let calls = 0;
    const counting = createProxmox({
      config: () => config([at(goodPort)]),
      get: async (...args) => {
        calls++;
        return getJson(...args);
      },
      now: () => 0,
    });
    await Promise.all([counting(), counting(), counting()]);
    expect(calls).toBe(2); // the resources, then the one online node's disks
  });
});

describe("its configuration", () => {
  const ca = () => cluster.ca;
  const env = (over: Record<string, string>) => ({
    CENACLE_PROXMOX_NODES: "alpha@alpha.exemple.test:8006",
    CENACLE_PROXMOX_CA: "/k/pve-root-ca.pem",
    CENACLE_PROXMOX_TOKEN: TOKEN,
    ...over,
  });
  it("nothing set: absent, nothing read", () => {
    expect(proxmoxConfig({}, ca)).toBe("absent");
  });
  it.each([
    ["a token out of shape", { CENACLE_PROXMOX_TOKEN: "root@pam!x=letmein" }],
    ["a relative authority path", { CENACLE_PROXMOX_CA: "pve-root-ca.pem" }],
    ["a node without its name", { CENACLE_PROXMOX_NODES: "alpha.exemple.test:8006" }],
    ["an address that is an option", { CENACLE_PROXMOX_NODES: "alpha@-oProxy:8006" }],
    ["no port", { CENACLE_PROXMOX_NODES: "alpha@alpha.exemple.test" }],
  ])("%s: said wrong, never read", (_what, over) => {
    expect(proxmoxConfig(env(over), ca)).toBe("config");
  });
  it("an authority file that is no certificate: wrong", () => {
    expect(proxmoxConfig(env({}), () => "not a certificate")).toBe("config");
  });
});

describe("the answers, checked field by field", () => {
  it("a node without a name, or a guest without an id: refused whole", () => {
    expect(() => parseResources({ data: [{ type: "node" }] })).toThrow();
    expect(() => parseResources({ data: [{ type: "lxc", node: "alpha" }] })).toThrow();
    expect(() => parseResources({ nodata: [] })).toThrow();
  });
  it("a disk whose device is not a device: refused; an odd model is cleaned", () => {
    expect(() => parseDisks({ data: [{ devpath: "/etc/passwd" }] })).toThrow();
    const [d] = parseDisks({
      data: [{ devpath: "/dev/nvme0n1", model: "<b>X</b>", wearout: "N/A" }],
    });
    expect(d).toMatchObject({ model: "bXb", wearLeft: null, healthy: null });
  });
});
