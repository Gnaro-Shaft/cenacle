// A server's bulletin (ADR-0039): read whole or not at all. Cut short, a key
// twice, a key it does not know, a value out of shape — unreadable, never
// half shown.
import { describe, expect, it } from "vitest";
import { BulletinError, MAX_BULLETIN, parseBulletin } from "./bulletin.ts";

const lines = (extra: string[] = [], drop: string[] = []) =>
  [
    "bulletin=1",
    "version=1",
    "hote=alpha",
    "instant=1794679266",
    "uptime=594880",
    "charge1=34",
    "charge5=24",
    "charge15=21",
    "processeurs=4",
    "memoire.totale=8122332",
    "memoire.disponible=5204712",
    "disque.1.montage=/",
    "disque.1.pourcent=41",
    "disque.1.kilooctets=30832548",
    "disque.2.montage=/var/lib/vz",
    "disque.2.pourcent=87",
    "disque.2.kilooctets=954925484",
    ...extra,
    "fin=1",
  ]
    .filter((l) => !drop.some((d) => l.startsWith(`${d}=`)))
    .join("\n");

describe("a bulletin as the script recites it", () => {
  it("every measure, in whole numbers", () => {
    expect(parseBulletin(lines())).toEqual({
      host: "alpha",
      at: 1794679266000,
      uptimeSeconds: 594880,
      load: [34, 24, 21],
      cpus: 4,
      memory: { total: 8122332, available: 5204712 },
      disks: [
        { mount: "/", percent: 41, kilobytes: 30832548 },
        { mount: "/var/lib/vz", percent: 87, kilobytes: 954925484 },
      ],
    });
  });

  it("a fact the server could not read is simply missing: said unknown, not zero", () => {
    const b = parseBulletin(lines([], ["charge1", "memoire.disponible", "uptime"]));
    expect(b.load).toBeNull();
    expect(b.memory).toBeNull();
    expect(b.uptimeSeconds).toBeNull();
  });
});

describe("refused whole", () => {
  it.each([
    ["cut short", lines().replace("\nfin=1", "")],
    ["no opening line", lines().replace("bulletin=1\n", "")],
    ["a key twice", lines(["charge1=12"])],
    ["a key it does not know", lines(["ssh.refus=3"])],
    ["an unknown version", lines().replace("version=1", "version=2")],
    ["undated", lines([], ["instant"])],
    ["a decimal where a whole number goes", lines().replace("charge1=34", "charge1=0.34")],
    ["a negative number", lines().replace("processeurs=4", "processeurs=-4")],
    ["more than 100 %", lines().replace("disque.1.pourcent=41", "disque.1.pourcent=140")],
    [
      "more memory available than there is",
      lines().replace("memoire.disponible=5204712", "memoire.disponible=9999999"),
    ],
    [
      "a mount that climbs out",
      lines().replace("disque.2.montage=/var/lib/vz", "disque.2.montage=/var/../etc"),
    ],
    [
      "a mount with a space",
      lines().replace("disque.2.montage=/var/lib/vz", "disque.2.montage=/a b"),
    ],
    ["a disk half said", lines([], ["disque.2.kilooctets"])],
    [
      "a disk skipped",
      lines(["disque.4.montage=/srv", "disque.4.pourcent=1", "disque.4.kilooctets=1"]),
    ],
    ["a host name that is an option", lines().replace("hote=alpha", "hote=-oProxyCommand")],
    ["a line without key", lines(["=x"])],
  ])("%s", (_what, raw) => {
    expect(() => parseBulletin(raw)).toThrow(BulletinError);
  });

  it("larger than any bulletin: refused before it is read", () => {
    expect(() => parseBulletin(lines([`x${"y".repeat(MAX_BULLETIN)}=1`]))).toThrow(/too large/);
  });

  it("a control character is taken out by the shared cleaning, never shown", () => {
    const b = parseBulletin(lines().replace("hote=alpha", "hote=alpha\u0007"));
    expect(b.host).toBe("alpha");
  });
});
