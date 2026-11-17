// The real bulletin script, version 2 (ADR-0040), with the server's commands
// played by stand-ins in a throwaway Debian container (no network): sudo as
// the frozen rules allow it and nothing more, needrestart, pvecm, ss, apt.
// What is checked is what Legion paid for: a command that fails is never a 0,
// a short-lived UDP port is not a port, and no address ever leaves the server.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseBulletin } from "./bulletin.ts";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "deploy",
  "serveurs",
  "cenacle-bulletin",
);
const IMAGE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";
const DIR = mkdtempSync(join(tmpdir(), "cenacle-bulletin-v2-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const sh = (body: string) => `#!/bin/bash\n${body}\n`;

/** sudo as /etc/sudoers.d/cenacle allows it: the two frozen commands, -n, nothing else. */
const SUDO_FROZEN = sh(`[ "$1" = "-n" ] || exit 1; shift
case "$*" in
  "/usr/sbin/needrestart -r l -b"|"/usr/bin/pvecm status") export VIA_SUDO=1; exec "$@" ;;
  *) echo "sudo: a password is required" >&2; exit 1 ;;
esac`);
const SUDO_REFUSED = sh(`echo "sudo: a password is required" >&2; exit 1`);

const NEEDRESTART = sh(`cat <<'EOF'
NEEDRESTART-VER: 3.6
NEEDRESTART-KCUR: 6.1.0-28-amd64
NEEDRESTART-KSTA: 1
NEEDRESTART-SVC: secretname-db.service
NEEDRESTART-SVC: cron.service
EOF`);

/** pvecm that answers only through sudo, as for the cenacle account on a node. */
const PVECM = (quorate: "Yes" | "No", votes: number) =>
  sh(`[ -n "\${VIA_SUDO:-}" ] || { echo "ipcc_send_rec failed" >&2; exit 2; }
cat <<'EOF'
Quorum information
------------------
Nodes:            ${votes}
Quorate:          ${quorate}

Votequorum information
----------------------
Expected votes:   2
Total votes:      ${votes}
EOF`);

const SS_FIRST = `tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*
tcp LISTEN 0 128 [::]:22 [::]:*
tcp LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*
tcp LISTEN 0 128 [::1]:631 [::]:*
tcp LISTEN 0 128 [fd7a:115c:a1e0::7]:443 [::]:*
udp UNCONN 0 0 100.64.0.7:41641 0.0.0.0:*
udp UNCONN 0 0 0.0.0.0:53817 0.0.0.0:*`;
/** The second reading: the short-lived UDP socket on 53817 is gone. */
const SS_SECOND = SS_FIRST.split("\n").slice(0, 6).join("\n");
/** ss read twice; the second reading may fail. Both readings may be given. */
const ss = (second: "ok" | "fails", lines1 = SS_FIRST, lines2 = SS_SECOND) =>
  sh(`f=/tmp/ss-count; n=$(( $(cat $f 2>/dev/null || echo 0) + 1 )); echo $n > $f
if [ $n = 1 ]; then cat <<'EOF'
${lines1}
EOF
elif [ ${second === "ok" ? 1 : 0} = 1 ]; then cat <<'EOF'
${lines2}
EOF
else exit 1; fi`);
/** The same lines in both readings. */
const ssSteady = (lines: string) => ss("ok", lines, lines);

let files = 0;
/** Runs the script in a fresh container, each stand-in mounted at its path. */
function recite(stubs: Record<string, string>): string {
  const args = ["run", "--rm", "--network", "none", "-v", `${SCRIPT}:/b:ro`];
  for (const [path, content] of Object.entries(stubs)) {
    const file = join(DIR, `stub-${files++}`);
    writeFileSync(file, content);
    chmodSync(file, 0o755);
    args.push("-v", `${file}:${path}:ro`);
  }
  return execFileSync("docker", [...args, IMAGE, "bash", "/b"], { encoding: "utf8" });
}

const SUDO = "/usr/local/bin/sudo";
const SS = "/usr/local/bin/ss";
const APT_CHECK = "/usr/lib/update-notifier/apt-check";
const healthy: Record<string, string> = {
  [SUDO]: SUDO_FROZEN,
  "/usr/sbin/needrestart": NEEDRESTART,
  "/usr/bin/pvecm": PVECM("Yes", 2),
  [SS]: ss("ok"),
  [APT_CHECK]: sh(`echo "12;3" >&2`),
  "/run/reboot-required": "*** System restart required ***\n",
  // A member of a cluster: its local corosync configuration.
  "/etc/corosync/corosync.conf": "totem {\n  cluster_name: exemple\n}\n",
};
const without = (path: string) =>
  Object.fromEntries(Object.entries(healthy).filter(([p]) => p !== path));

describe("cenacle-bulletin version 2, with the server's commands played by stand-ins", () => {
  const raw = () => recite(healthy);

  it("a node in good order: every fact, read whole — and no address, no service name", () => {
    const text = raw();
    expect(parseBulletin(text).health).toEqual({
      rebootRequired: true,
      updates: { total: 12, security: 3 },
      servicesToRestart: 2,
      cluster: { quorum: "oui", votes: 2, expected: 2 },
      ports: [
        { scope: "local", protocol: "tcp", port: 53 },
        { scope: "local", protocol: "tcp", port: 631 },
        { scope: "tailnet", protocol: "tcp", port: 443 },
        { scope: "tailnet", protocol: "udp", port: 41641 },
        { scope: "autre", protocol: "tcp", port: 22 },
      ],
    });
    // The UDP socket seen in one reading only (tailscaled's probes) is not a port.
    expect(text).not.toContain("53817");
    for (const leak of ["100.64", "127.0", "0.0.0.0", "fd7a", "::1", "%lo", "secretname", "cron"]) {
      expect(text).not.toContain(leak);
    }
  }, 120_000);

  it("sudo refused: no count of services, and a mute cluster is 'illisible' — never 0, never 'oui'", () => {
    const b = parseBulletin(recite({ ...healthy, [SUDO]: SUDO_REFUSED }));
    expect(b.health?.servicesToRestart).toBeNull();
    expect(b.health?.cluster).toEqual({ quorum: "illisible", votes: null, expected: null });
  }, 120_000);

  it("needrestart answering out of its batch form: not counted", () => {
    const b = parseBulletin(
      recite({ ...healthy, "/usr/sbin/needrestart": sh("echo 'Scanning processes...'") }),
    );
    expect(b.health?.servicesToRestart).toBeNull();
  }, 120_000);

  it("a cluster without quorum says so, with its votes", () => {
    const b = parseBulletin(recite({ ...healthy, "/usr/bin/pvecm": PVECM("No", 1) }));
    expect(b.health?.cluster).toEqual({ quorum: "non", votes: 1, expected: 2 });
  }, 120_000);

  it.each([
    ["apt-check out of shape", sh(`echo "error" >&2`)],
    ["apt-check failing", sh(`echo "1;0" >&2; exit 1`)],
  ])(
    "%s: no update count at all",
    (_what, check) => {
      const b = parseBulletin(recite({ ...healthy, [APT_CHECK]: check }));
      expect(b.health?.updates).toBeNull();
    },
    120_000,
  );

  it("apt-get failing (no apt-check): no update count — Legion's said 0", () => {
    const b = parseBulletin(
      recite({ ...without(APT_CHECK), "/usr/local/bin/apt-get": sh("exit 100") }),
    );
    expect(b.health?.updates).toBeNull();
  }, 120_000);

  it("apt-get simulating: security updates counted among the others", () => {
    const simulated = sh(`cat <<'EOF'
Reading package lists...
Inst libssl3 [3.0.1] (3.0.2 Debian-Security:12/stable-security [amd64])
Inst curl [7.1] (7.2 Debian:12/stable [amd64])
Inst tzdata [2024a] (2024b Debian:12/stable-updates [all])
Conf libssl3 (3.0.2 Debian-Security:12/stable-security [amd64])
EOF`);
    const b = parseBulletin(recite({ ...without(APT_CHECK), "/usr/local/bin/apt-get": simulated }));
    expect(b.health?.updates).toEqual({ total: 3, security: 1 });
  }, 120_000);

  it("the second reading of ss failing: no ports at all, never half a list", () => {
    const b = parseBulletin(recite({ ...healthy, [SS]: ss("fails") }));
    expect(b.health?.ports).toBeNull();
  }, 120_000);

  it("a plain Debian machine: no reboot asked, nothing off a cluster, nothing it cannot read", () => {
    const b = parseBulletin(recite({}));
    expect(b.version).toBe(3);
    expect(b.health?.rebootRequired).toBe(false);
    expect(b.health?.cluster).toBeNull();
    expect(b.health?.servicesToRestart).toBeNull();
    expect(b.health?.ports).toBeNull();
  }, 120_000);
  it("pvecm installed but no cluster (a lone Proxmox host): nothing said, not 'illisible'", () => {
    const b = parseBulletin(recite(without("/etc/corosync/corosync.conf")));
    expect(b.health?.cluster).toBeNull();
  }, 120_000);

  it("a hung pvecm or needrestart costs its own fact, never the whole bulletin", () => {
    const started = Date.now();
    const b = parseBulletin(
      recite({
        ...healthy,
        "/usr/bin/pvecm": sh("sleep 60"),
        "/usr/sbin/needrestart": sh("sleep 60"),
      }),
    );
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(b.health?.cluster).toEqual({ quorum: "illisible", votes: null, expected: null });
    expect(b.health?.servicesToRestart).toBeNull();
    expect(b.health?.updates).toEqual({ total: 12, security: 3 });
  }, 120_000);

  it.each([
    ["an address without a port", "tcp LISTEN 0 4096 10.1.2.3 0.0.0.0:*"],
    ["a port that is not a number", "tcp LISTEN 0 4096 10.1.2.3:ssh 0.0.0.0:*"],
    ["a protocol of its own", "sctp LISTEN 0 4096 10.1.2.3:22 0.0.0.0:*"],
    ["a port out of range", "tcp LISTEN 0 4096 10.1.2.3:70000 0.0.0.0:*"],
  ])(
    "ss with a line out of form (%s): no ports at all, and the address never said",
    (_what, line) => {
      const text = recite({
        ...healthy,
        [SS]: ssSteady(`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n${line}`),
      });
      expect(parseBulletin(text).health?.ports).toBeNull();
      expect(text).not.toContain("10.1.2.3");
    },
    120_000,
  );

  it("an IPv4 address written as IPv6 is classed as itself", () => {
    const lines = [
      "tcp LISTEN 0 128 [::ffff:127.0.0.1]:8080 [::]:*",
      "tcp LISTEN 0 128 [::ffff:100.64.0.9]:8443 [::]:*",
      "tcp LISTEN 0 128 [::ffff:192.0.2.1]:8000 [::]:*",
    ].join("\n");
    const text = recite({ ...healthy, [SS]: ssSteady(lines) });
    expect(parseBulletin(text).health?.ports).toEqual([
      { scope: "local", protocol: "tcp", port: 8080 },
      { scope: "tailnet", protocol: "tcp", port: 8443 },
      { scope: "autre", protocol: "tcp", port: 8000 },
    ]);
    expect(text).not.toContain("ffff");
  }, 120_000);

  it("a package whose name says 'security' is not a security update", () => {
    const simulated = sh(`cat <<'EOF'
Inst libsecurity-tools [1.0] (1.1 Debian:12/stable [amd64])
Inst libssl3 [3.0.1] (3.0.2 Debian-Security:12/stable-security [amd64])
EOF`);
    const b = parseBulletin(recite({ ...without(APT_CHECK), "/usr/local/bin/apt-get": simulated }));
    expect(b.health?.updates).toEqual({ total: 2, security: 1 });
  }, 120_000);
});
