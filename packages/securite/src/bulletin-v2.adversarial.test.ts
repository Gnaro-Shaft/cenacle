// A version 2 bulletin (ADR-0040): what the ronde judges, read whole or not
// at all. A fact the server could not read is absent and stays unknown —
// never a zero, never "healthy" by default.
import { describe, expect, it } from "vitest";
import { BulletinError, parseBulletin } from "./bulletin.ts";
import { MAX_PORTS } from "./bulletin-health.ts";

const BASE = [
  "bulletin=1",
  "version=2",
  "hote=alpha",
  "instant=1794679266",
  "charge1=34",
  "charge5=24",
  "charge15=21",
  "disque.1.montage=/",
  "disque.1.pourcent=41",
  "disque.1.kilooctets=30832548",
  "redemarrage=non",
  "maj.total=7",
  "maj.securite=2",
  "services.a_relancer=3",
  "grappe.quorum=oui",
  "grappe.votes=2",
  "grappe.attendus=2",
  "ports=local/tcp/631,tailnet/udp/41641,tcp/22,udp/53",
];

const lines = (extra: string[] = [], drop: string[] = []) =>
  [...BASE.filter((l) => !drop.some((d) => l.startsWith(`${d}=`))), ...extra, "fin=1"].join("\n");

/** The base bulletin with one line changed; throws if the line is not there. */
function swap(from: string, to: string): string {
  const base = lines();
  if (!base.includes(from)) throw new Error(`no line ${from} to swap`);
  return base.replace(from, to);
}

/** The base bulletin with its ports said otherwise. */
const ports = (value: string) => lines([`ports=${value}`], ["ports"]);

describe("a version 2 bulletin as the script recites it", () => {
  it("every fact the ronde judges", () => {
    const b = parseBulletin(lines());
    expect(b.version).toBe(2);
    expect(b.health).toEqual({
      rebootRequired: false,
      updates: { total: 7, security: 2 },
      servicesToRestart: 3,
      cluster: { quorum: "oui", votes: 2, expected: 2 },
      ports: [
        { scope: "local", protocol: "tcp", port: 631 },
        { scope: "tailnet", protocol: "udp", port: 41641 },
        { scope: "autre", protocol: "tcp", port: 22 },
        { scope: "autre", protocol: "udp", port: 53 },
      ],
    });
  });

  it("the measures are read as in version 1", () => {
    const b = parseBulletin(lines());
    expect(b.load).toEqual([34, 24, 21]);
    expect(b.disks).toEqual([{ mount: "/", percent: 41, kilobytes: 30832548 }]);
  });

  it("a reboot required is said so", () => {
    const b = parseBulletin(swap("redemarrage=non", "redemarrage=requis"));
    expect(b.health?.rebootRequired).toBe(true);
  });

  it("what the server could not read stays unknown: null, never zero, never an empty list", () => {
    const h = parseBulletin(
      lines([], ["maj.total", "maj.securite", "services.a_relancer", "ports"]),
    ).health;
    expect(h?.updates).toBeNull();
    expect(h?.servicesToRestart).toBeNull();
    expect(h?.ports).toBeNull();
  });

  it("off a cluster, no quorum at all — and a quorum without its votes is still read", () => {
    const off = parseBulletin(lines([], ["grappe.quorum", "grappe.votes", "grappe.attendus"]));
    expect(off.health?.cluster).toBeNull();
    const mute = parseBulletin(
      lines(["grappe.quorum=illisible"], ["grappe.quorum", "grappe.votes", "grappe.attendus"]),
    );
    expect(mute.health?.cluster).toEqual({ quorum: "illisible", votes: null, expected: null });
  });

  it("zero is a real answer when the server said it", () => {
    const h = parseBulletin(
      swap("maj.total=7", "maj.total=0")
        .replace("maj.securite=2", "maj.securite=0")
        .replace("services.a_relancer=3", "services.a_relancer=0"),
    ).health;
    expect(h?.updates).toEqual({ total: 0, security: 0 });
    expect(h?.servicesToRestart).toBe(0);
  });

  it("a version 1 bulletin has no health: null, not a healthy default", () => {
    const v1 = BASE.slice(0, 10)
      .map((l) => (l === "version=2" ? "version=1" : l))
      .concat("fin=1")
      .join("\n");
    const b = parseBulletin(v1);
    expect(b.version).toBe(1);
    expect(b.health).toBeNull();
  });
});

describe("refused whole", () => {
  const many = Array.from({ length: MAX_PORTS + 1 }, (_, i) => `tcp/${i + 1}`).join(",");
  it.each([
    ["a version 2 key in a version 1 bulletin", swap("version=2", "version=1")],
    ["a version 2 bulletin without its reboot line", lines([], ["redemarrage"])],
    ["a reboot neither required nor not", swap("redemarrage=non", "redemarrage=peut-etre")],
    ["an empty reboot", swap("redemarrage=non", "redemarrage=")],
    ["updates half said (total only)", lines([], ["maj.securite"])],
    ["updates half said (security only)", lines([], ["maj.total"])],
    ["more security updates than updates", swap("maj.securite=2", "maj.securite=9")],
    ["a negative count", swap("services.a_relancer=3", "services.a_relancer=-1")],
    ["an empty count (a failed command read as nothing)", swap("maj.total=7", "maj.total=")],
    ["a count with text", swap("services.a_relancer=3", "services.a_relancer=3 services")],
    ["votes without a quorum", lines([], ["grappe.quorum"])],
    ["a quorum in other words", swap("grappe.quorum=oui", "grappe.quorum=Yes")],
    ["an empty port list (unknown said as nothing)", ports("")],
    ["a port with its address", ports("100.64.1.2:22")],
    ["a port with an address as its scope", ports("0.0.0.0/tcp/22")],
    ["a scope of its own", ports("public/tcp/22")],
    ["a protocol of its own", ports("sctp/22")],
    ["a joker (a declaration, never a fact)", ports("tcp/*")],
    ["port zero", ports("tcp/0")],
    ["a port beyond 65535", ports("tcp/65536")],
    ["the same port twice", ports("tcp/22,tcp/22")],
    ["an empty item between commas", ports("tcp/22,,udp/53")],
    ["a trailing comma", ports("tcp/22,")],
    ["a port with a space", ports("tcp/22, udp/53")],
    [`more than ${MAX_PORTS} ports`, ports(many)],
    ["a fail2ban counter (Legion's, never ours)", lines(["f2b.vus=12"])],
    ["an SSH refusal count (about third parties)", lines(["ssh.refus=3"])],
    ["Legion's name for the services key", lines(["services.a_redemarrer=3"])],
    ["a key twice", lines(["ports=tcp/80"])],
  ])("%s", (_what, raw) => {
    expect(() => parseBulletin(raw)).toThrow(BulletinError);
  });

  it("exactly the most ports allowed is still read", () => {
    const most = Array.from({ length: MAX_PORTS }, (_, i) => `tcp/${i + 1}`).join(",");
    expect(parseBulletin(ports(most)).health?.ports).toHaveLength(MAX_PORTS);
  });
});
