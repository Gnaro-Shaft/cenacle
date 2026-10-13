// The server's own guards (J6f2, ADR-0027): deploy/serveurs/cenacle-redemarrer,
// run for real in a throwaway Ubuntu container. It reboots only when asked to,
// after 24 hours up, with no guest running, and on a cluster only when every
// vote is there and the votes left while this node is down are still a strict
// majority — two nodes without a QDevice never qualify. Skipped without Docker.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docker, ROOT, scratch } from "./test-docker.ts";

const BASE = scratch();

// cenacle-redemarrer (J6f2): the uptime is a fake /proc/uptime bound into the
// container (as LXCFS does), shutdown and pvecm are stand-ins.
const REBOOT_HARNESS = String.raw`#!/bin/bash
set -u
mkdir -p /fake && chmod 777 /fake
printf '#!/bin/sh\n[ -e /fake/shutdown-fails ] && exit 1\necho "$1 $2" > /fake/shutdown\n' > /usr/sbin/shutdown
chmod 755 /usr/sbin/shutdown
pvecm() { printf '#!/bin/sh\n[ -e /fake/pvecm-fails ] && exit 1\ncat /fake/pvecm\n' > /usr/bin/pvecm; chmod 755 /usr/bin/pvecm; printf '%b' "$1" > /fake/pvecm; }
run() {
  name=$1; shift
  rm -f /fake/shutdown
  /usr/local/sbin/cenacle-redemarrer "$@" >/dev/null 2>&1; code=$?
  echo "$name|$code|$(cat /fake/shutdown 2>/dev/null)"
}
rm -f /var/run/reboot-required; run nothing_required
touch /var/run/reboot-required; run standalone
# Membership lines as pvecm prints them; the addresses are documentation ones.
M='\nMembership information\n----------------------\n    Nodeid      Votes Name\n'
L1='0x00000002          1 192.0.2.3 (local)\n'
O1='0x00000003          1 192.0.2.1\n'
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      3\n$M$L1$O1""0x00000001          1 192.0.2.2\n"; run cluster_full
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      2\n$M$L1$O1"; run cluster_missing
pvecm "Quorate:          Yes\nExpected votes:   2\nTotal votes:      2\n$M$L1$O1"; run cluster_two_nodes
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      3\n$M$L1$O1""0x00000000          1            Qdevice\n"; run cluster_qdevice
pvecm "Quorate:          Yes\nExpected votes:   1\nTotal votes:      1\n$M$L1"; run cluster_single
pvecm "Quorate:          Yes\nExpected votes:   4\nTotal votes:      4\n$M""0x00000002          2 192.0.2.3 (local)\n$O1""0x00000001          1 192.0.2.2\n"; run cluster_heavy_node
pvecm "Quorate:          Yes\nExpected votes:   5\nTotal votes:      5\n$M""0x00000002          2 192.0.2.3 (local)\n$O1""0x00000001          2 192.0.2.2\n"; run cluster_heavy_ok
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      3\n$M$O1""0x00000001          1 192.0.2.2\n"; run cluster_no_local
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      3\n$M$L1$L1""0x00000001          1 192.0.2.2\n"; run cluster_two_local
pvecm "Quorate:          Yes\nExpected votes:   3\nTotal votes:      3\n$M""0x00000002          x 192.0.2.3 (local)\n$O1"; run cluster_local_garbage
pvecm 'Quorate:          No\nExpected votes:   3\nTotal votes:      1\n'; run cluster_no_quorum
pvecm 'Quorate:          No\nExpected votes:   3\nTotal votes:      3\n'; run cluster_not_quorate_full
pvecm 'nothing useful\n'; run cluster_garbage
touch /fake/pvecm-fails; run cluster_fails; rm -f /fake/pvecm-fails /usr/bin/pvecm
guests() { printf '#!/bin/sh
[ -e /fake/qm-fails ] && exit 1
printf "%%b" "$(cat /fake/qm)"
' > /usr/sbin/qm; printf '#!/bin/sh
printf "%%b" "$(cat /fake/pct)"
' > /usr/sbin/pct; chmod 755 /usr/sbin/qm /usr/sbin/pct; printf '%s' "$1" > /fake/qm; printf '%s' "$2" > /fake/pct; }
guests 'VMID NAME STATUS MEM(MB) BOOTDISK(GB) PID
100 docker-stack running 8192 64.00 1234
' 'VMID Status Lock Name
'; run guest_vm
guests 'VMID NAME STATUS MEM(MB) BOOTDISK(GB) PID
' 'VMID Status Lock Name
200 running  web
'; run guest_ct
guests 'VMID NAME STATUS MEM(MB) BOOTDISK(GB) PID
100 vieux stopped 512 8.00 0
' 'VMID Status Lock Name
201 stopped  ancien
'; run guests_stopped
touch /fake/qm-fails; run guests_unreadable; rm -f /fake/qm-fails /usr/sbin/qm /usr/sbin/pct
run argument now
touch /fake/shutdown-fails; run shutdown_fails; rm -f /fake/shutdown-fails
su nobody -s /bin/bash -c '/usr/local/sbin/cenacle-redemarrer' >/dev/null 2>&1; echo "not_root|$?|"
`;

function rebootRun(uptime: string): Map<string, { code: number; shutdown: string }> {
  const harness = join(BASE, "reboot-harness.sh");
  const up = join(BASE, `uptime-${uptime}`);
  writeFileSync(harness, REBOOT_HARNESS, { mode: 0o755 });
  writeFileSync(up, `${uptime}.00 10.00\n`);
  const out = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      `${join(ROOT, "deploy", "serveurs", "cenacle-redemarrer")}:/usr/local/sbin/cenacle-redemarrer:ro`,
      "-v",
      `${harness}:/harness.sh:ro`,
      "-v",
      `${up}:/proc/uptime:ro`,
      "ubuntu:24.04",
      "/bin/bash",
      "/harness.sh",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  const results = new Map<string, { code: number; shutdown: string }>();
  for (const line of out.trim().split("\n")) {
    const [name = "", code = "", shutdown = ""] = line.split("|");
    results.set(name, { code: Number(code), shutdown: shutdown.trim() });
  }
  return results;
}

describe.skipIf(!docker)("cenacle-redemarrer on a throwaway Ubuntu", () => {
  it("up for more than 24 hours: each guard, and the reboot scheduled a minute on", () => {
    expect(Object.fromEntries(rebootRun("200000"))).toEqual({
      nothing_required: { code: 10, shutdown: "" },
      standalone: { code: 0, shutdown: "-r +1" },
      cluster_full: { code: 0, shutdown: "-r +1" },
      cluster_missing: { code: 11, shutdown: "" },
      cluster_two_nodes: { code: 11, shutdown: "" },
      cluster_qdevice: { code: 0, shutdown: "-r +1" },
      cluster_single: { code: 11, shutdown: "" },
      cluster_heavy_node: { code: 11, shutdown: "" },
      cluster_heavy_ok: { code: 0, shutdown: "-r +1" },
      cluster_no_local: { code: 11, shutdown: "" },
      cluster_two_local: { code: 11, shutdown: "" },
      cluster_local_garbage: { code: 11, shutdown: "" },
      cluster_no_quorum: { code: 11, shutdown: "" },
      cluster_not_quorate_full: { code: 11, shutdown: "" },
      cluster_garbage: { code: 11, shutdown: "" },
      cluster_fails: { code: 11, shutdown: "" },
      guest_vm: { code: 11, shutdown: "" },
      guest_ct: { code: 11, shutdown: "" },
      guests_stopped: { code: 0, shutdown: "-r +1" },
      guests_unreadable: { code: 11, shutdown: "" },
      argument: { code: 11, shutdown: "" },
      shutdown_fails: { code: 12, shutdown: "" },
      not_root: { code: 11, shutdown: "" },
    });
  });

  it("up for less than 24 hours: refused, even when a reboot is required", () => {
    const r = rebootRun("100");
    expect(r.get("standalone")).toEqual({ code: 11, shutdown: "" });
    expect(r.get("nothing_required")).toEqual({ code: 10, shutdown: "" });
  });
});
