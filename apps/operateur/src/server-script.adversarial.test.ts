// The server's own guards (J6f, ADR-0027): deploy/serveurs/cenacle-services,
// run for real in a throwaway Ubuntu container, with stand-ins for
// needrestart and systemctl. It restarts only what needrestart lists, never
// an exclusion (default or added), refuses a strange name, an unreadable
// answer, an argument, too many services, a caller who is not root — and
// says so by its exit code alone — the spared count folded in (20 + n,
// 120 + n; ADR-0035, point 7). Skipped where Docker is absent (the CI).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docker, ROOT, scratch } from "./test-docker.ts";

const SCRIPT = join(ROOT, "deploy", "serveurs", "cenacle-services");
const BASE = scratch();

const svc = (names: string[]) =>
  ["NEEDRESTART-VER: 3.6", ...names.map((n) => `NEEDRESTART-SVC: ${n}`)].join("\\n");
const many = Array.from({ length: 31 }, (_, i) => `s${i}.service`);
const ttys = (n: number) => Array.from({ length: n }, (_, i) => `getty@tty${i}.service`);
// What needrestart still listed on the site's VPS after its first 🔁 (2026-10-26):
// only what the script spares — Legion counted 5 and the proof said "still there".
const SPARED_ONLY = [
  "dbus.service",
  "ssh.service",
  "systemd-logind.service",
  "systemd-manager",
  "systemd-networkd.service",
];
// The lists needrestart gave on two Proxmox nodes after their security updates
// (homeserv03 on 2026-10-11; homeserv01 on 2026-10-12 adds "systemd-user").
const PROXMOX = [
  "cron.service",
  "dbus.service",
  "dm-event.service",
  "nfs-blkmap.service",
  "proxmox-firewall.service",
  "pve-cluster.service",
  "pve-firewall.service",
  "pve-ha-crm.service",
  "pve-ha-lrm.service",
  "pvedaemon.service",
  "pvefw-logger.service",
  "pveproxy.service",
  "pvescheduler.service",
  "pvestatd.service",
  "qmeventd.service",
  "rrdcached.service",
  "smartmontools.service",
  "spiceproxy.service",
  "ssh.service",
  "systemd-journald.service",
  "systemd-logind.service",
  "systemd-manager",
  "systemd-udevd.service",
  "unattended-upgrades.service",
  "zfs-zed.service",
];

// One container, every case: "name|exit code|services restarted".
const HARNESS = `#!/bin/bash
set -u
printf '#!/bin/sh\\nprintf "%%b\\\\n" "$(cat /fake/out)"\\n' > /usr/sbin/needrestart
printf '#!/bin/sh\\n[ "$2" = "--no-block" ] || exit 9\\n[ "$4" = "panne.service" ] && exit 1\\necho "$4" >> /fake/restarted\\n' > /usr/bin/systemctl
chmod 755 /usr/sbin/needrestart /usr/bin/systemctl
mkdir -p /fake /etc/cenacle && chmod 777 /fake
run() {
  name=$1; shift
  : > /fake/restarted
  /usr/local/sbin/cenacle-services "$@" >/dev/null 2>&1; code=$?
  echo "$name|$code|$(tr '\\n' ' ' < /fake/restarted)"
}
printf '%s' '${svc(["nginx.service", "docker.service", "ssh.service", "tailscaled.service"])}' > /fake/out; run usual
printf '%s' '${svc([])}' > /fake/out; run nothing
printf '%s' '${svc(["containerd.service", "corosync.service", "pve-cluster.service", "sshd.service"])}' > /fake/out; run only_excluded
printf '%s' '${svc(["x;rm.service"])}' > /fake/out; run strange_name
printf '%s' '${svc(["../evil.service"])}' > /fake/out; run path_name
printf '%s' 'NEEDRESTART-SVC: nginx.service' > /fake/out; run unreadable
printf '%s' '${svc(["nginx.service"])}' > /fake/out; run argument ls
printf '%s' '${svc(many)}' > /fake/out; run too_many
printf '%s' '${svc(["nginx.service", "panne.service"])}' > /fake/out; run failure
printf '# mine\\nnginx.service\\n' > /etc/cenacle/services-exclus
printf '%s' '${svc(["nginx.service", "cron.service"])}' > /fake/out; run added_exclusion
rm /etc/cenacle/services-exclus
printf '%s' '${svc(PROXMOX)}' > /fake/out; run proxmox
printf '%s' '${svc([...PROXMOX, "systemd-user"])}' > /fake/out; run proxmox_with_users
printf '%s' '${svc(["systemd-manager"])}' > /fake/out; run systemd_only
printf '%s' '${svc(["systemd-user", "systemd-manager"])}' > /fake/out; run systemd_both
printf '%s' '${svc(["systemd-users"])}' > /fake/out; run systemd_user_lookalike
printf '%s' '${svc(["systemd-managerx"])}' > /fake/out; run systemd_lookalike
printf '%s' '${svc(["getty@tty1.service", "user@1000.service", "serial-getty@ttyS0.service", "cron.service"])}' > /fake/out; run sessions
printf '%s' '${svc(SPARED_ONLY)}' > /fake/out; run spared_only
printf '%s' '${svc([...ttys(99), "cron.service"])}' > /fake/out; run spared_99
printf '%s' '${svc([...ttys(100), "cron.service"])}' > /fake/out; run spared_100
printf '%s' '${svc(ttys(99))}' > /fake/out; run spared_99_nothing
printf '%s' '${svc(ttys(100))}' > /fake/out; run spared_100_nothing
printf '%s' '${svc(["nginx.service"])}' > /fake/out
: > /fake/restarted
su nobody -s /bin/bash -c '/usr/local/sbin/cenacle-services' >/dev/null 2>&1; echo "not_root|$?|$(tr '\\n' ' ' < /fake/restarted)"
`;

describe.skipIf(!docker)("cenacle-services on a throwaway Ubuntu", () => {
  const results = new Map<string, { code: number; restarted: string[] }>();

  it("runs every case in one container", () => {
    const harness = join(BASE, "harness.sh");
    writeFileSync(harness, HARNESS, { mode: 0o755 });
    const out = execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${SCRIPT}:/usr/local/sbin/cenacle-services:ro`,
        "-v",
        `${harness}:/harness.sh:ro`,
        "ubuntu:24.04",
        "/bin/bash",
        "/harness.sh",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    for (const line of out.trim().split("\n")) {
      const [name = "", code = "", restarted = ""] = line.split("|");
      results.set(name, {
        code: Number(code),
        restarted: restarted.trim().split(" ").filter(Boolean),
      });
    }
    expect(results.size).toBe(23);
  });

  it.each([
    ["usual", 23, ["nginx.service"]],
    ["nothing", 10, []],
    ["only_excluded", 124, []],
    ["strange_name", 11, []],
    ["path_name", 11, []],
    ["unreadable", 11, []],
    ["argument", 11, []],
    ["too_many", 11, []],
    ["failure", 12, ["nginx.service"]],
    ["added_exclusion", 21, ["cron.service"]],
    ["not_root", 11, []],
    [
      "proxmox",
      27,
      [
        "cron.service",
        "dm-event.service",
        "nfs-blkmap.service",
        "proxmox-firewall.service",
        "pve-firewall.service",
        "pvedaemon.service",
        "pvefw-logger.service",
        "pveproxy.service",
        "pvescheduler.service",
        "pvestatd.service",
        "qmeventd.service",
        "rrdcached.service",
        "smartmontools.service",
        "spiceproxy.service",
        "systemd-journald.service",
        "systemd-udevd.service",
        "unattended-upgrades.service",
        "zfs-zed.service",
      ],
    ],
    [
      "proxmox_with_users",
      28,
      [
        "cron.service",
        "dm-event.service",
        "nfs-blkmap.service",
        "proxmox-firewall.service",
        "pve-firewall.service",
        "pvedaemon.service",
        "pvefw-logger.service",
        "pveproxy.service",
        "pvescheduler.service",
        "pvestatd.service",
        "qmeventd.service",
        "rrdcached.service",
        "smartmontools.service",
        "spiceproxy.service",
        "systemd-journald.service",
        "systemd-udevd.service",
        "unattended-upgrades.service",
        "zfs-zed.service",
      ],
    ],
    ["systemd_both", 122, []],
    ["systemd_user_lookalike", 11, []],
    ["systemd_only", 121, []],
    ["systemd_lookalike", 11, []],
    ["sessions", 23, ["cron.service"]],
    ["spared_only", 125, []],
    ["spared_99", 119, ["cron.service"]],
    ["spared_100", 0, ["cron.service"]],
    ["spared_99_nothing", 219, []],
    ["spared_100_nothing", 10, []],
  ])("%s → exit %i, restarted %j", (name, code, restarted) => {
    expect(results.get(name)).toEqual({ code, restarted });
  });
});

// cenacle-maj-securite (J6f3): unattended-upgrade, apt-config, systemctl,
// systemd-run and df are stand-ins; the update is started, never run inline.
const UPDATE_HARNESS = String.raw`#!/bin/bash
set -u
mkdir -p /fake && chmod 777 /fake
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$1"; chmod 755 "$1"; }
stub /usr/bin/unattended-upgrade 'echo ran-inline > /fake/inline'
stub /usr/bin/apt-config 'cat /fake/aptconf 2>/dev/null'
stub /usr/bin/systemctl '[ -e /fake/active ] && exit 0; exit 3'
stub /usr/bin/systemd-run '[ -e /fake/run-fails ] && exit 1; echo "$@" > /fake/run'
stub /usr/bin/df 'printf "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 9 9 %s 50%% /\n" "$(cat /fake/free)"'
run() {
  name=$1; shift
  rm -f /fake/run /fake/inline
  /usr/local/sbin/cenacle-maj-securite "$@" >/dev/null 2>&1; code=$?
  echo "$name|$code|$(cat /fake/run 2>/dev/null)$(cat /fake/inline 2>/dev/null)"
}
echo 5000000 > /fake/free
: > /fake/aptconf; run nominal
echo 'Unattended-Upgrade::Automatic-Reboot "true";' > /fake/aptconf; run auto_reboot
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /fake/aptconf; run reboot_off
: > /fake/aptconf
touch /fake/active; run already_running; rm -f /fake/active
echo 500000 > /fake/free; run disk_full
echo 'n/a' > /fake/free; run disk_unreadable; echo 5000000 > /fake/free
run argument now
touch /fake/run-fails; run start_fails; rm -f /fake/run-fails
su nobody -s /bin/bash -c '/usr/local/sbin/cenacle-maj-securite' >/dev/null 2>&1; echo "not_root|$?|"
rm -f /usr/bin/unattended-upgrade; run no_tool
`;

describe.skipIf(!docker)("cenacle-maj-securite on a throwaway Ubuntu", () => {
  it("each guard; started in its own unit, never inline, never a reboot", () => {
    const harness = join(BASE, "update-harness.sh");
    writeFileSync(harness, UPDATE_HARNESS, { mode: 0o755 });
    const out = execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${join(ROOT, "deploy", "serveurs", "cenacle-maj-securite")}:/usr/local/sbin/cenacle-maj-securite:ro`,
        "-v",
        `${harness}:/harness.sh:ro`,
        "ubuntu:24.04",
        "/bin/bash",
        "/harness.sh",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    const results = Object.fromEntries(
      out
        .trim()
        .split("\n")
        .map((line) => {
          const [name = "", code = "", seen = ""] = line.split("|");
          return [name, { code: Number(code), seen: seen.trim() }];
        }),
    );
    const started = "--unit=cenacle-maj --collect --quiet /usr/bin/unattended-upgrade";
    expect(results).toEqual({
      nominal: { code: 0, seen: started },
      auto_reboot: { code: 11, seen: "" },
      reboot_off: { code: 0, seen: started },
      already_running: { code: 11, seen: "" },
      disk_full: { code: 11, seen: "" },
      disk_unreadable: { code: 11, seen: "" },
      argument: { code: 11, seen: "" },
      start_fails: { code: 12, seen: "" },
      not_root: { code: 11, seen: "" },
      no_tool: { code: 10, seen: "" },
    });
  });
});
