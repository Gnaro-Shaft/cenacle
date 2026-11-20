// eprouver-fail2ban.sh, Legion's trial (ADR-0045, H3), its failure check
// rewritten on 20/11: what the jail counted since fail2ban started, against
// what the journal holds since then, judged by the REAL fail2ban-regex in
// normal mode. The VPS answers through fakes (fail2ban-client, systemctl,
// journalctl); the journal is a file of made-up lines. Zero and zero is
// « nothing to judge » (exit 3), never ECHEC — the false alarm of 20/11.
// No real address: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24. Skipped
// without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const F = "/d/homelab/fail2ban";
const FAKES: Record<string, string> = {
  // The Mac's side: ssh runs its last argument here; sudo just runs.
  "fake/ssh": `echo "ssh $*" >> /tmp/appels-ssh; while [ $# -gt 1 ]; do shift; done; exec bash -c "$1"`,
  "fake/sudo": `[ "$1" = -n ] && shift; exec "$@"`,
  // The VPS's side: canned answers, tabulated as fail2ban-client prints them.
  "fake-vps/fail2ban-client": `case "$*" in
  "get sshd logencoding") echo UTF-8 ;;
  "status sshd") printf 'Status for the jail: sshd\\n|- Filter\\n|  |- Currently failed:\\t0\\n|  |- Total failed:\\t%s\\n|  \`- Journal matches:\\t_SYSTEMD_UNIT=ssh.service\\n\`- Actions\\n   |- Currently banned:\\t3\\n   \`- Banned IP list:\\t\\n' "\${FAUX_ECHECS-12}" ;;
  "get sshd ignoreip") printf 'These IP addresses/networks are ignored:\\n|- 127.0.0.0/8\\n|- ::1\\n\`- 192.0.2.10\\n' ;;
esac`,
  "fake-vps/systemctl": `case "$1" in
  show) echo "\${FAUX_DEPUIS-$(date -d '-30 min' '+%a %Y-%m-%d %H:%M:%S UTC')}" ;;
  *) echo "\${FAUX_ACTIF:-active}" ;;
esac`,
  "fake-vps/journalctl": `echo "journalctl $*" >> /tmp/appels-journal; cat /tmp/journal 2>/dev/null; true`,
  "fake-vps/fail2ban-regex": `[ -n "\${FAUX_SANS_REGEX:-}" ] && exit 1; exec /usr/bin/fail2ban-regex "$@"`,
};

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  for (const [path, body] of Object.entries(FAKES)) {
    box.sh(
      `mkdir -p /$(dirname ${path}) && printf '%s\\n' ${q(`#!/bin/bash\n${body}`)} > /${path}`,
    );
  }
  box.sh("chmod 755 /fake/* /fake-vps/*");
}, 600_000);
afterAll(() => box?.stop());

const at = "2026-11-20T08:30:01+0000 vps";
const LINE = {
  invalid: (from: string) => `${at} sshd[1002]: Invalid user admin from ${from} port 40001`,
  session: (from: string) =>
    `${at} sshd-session[1003]: Invalid user oracle from ${from} port 40002`,
  preauth: `${at} sshd[1001]: Connection closed by authenticating user root 203.0.113.5 port 40000 [preauth]`,
  accepted: `${at} sshd[1004]: Accepted publickey for debian from 192.0.2.10 port 40003 ssh2: ED25519 SHA256:x`,
};

/** The trial against a VPS whose journal holds these lines. */
function trial(lines: string[], env = "", args = "root@vps-exemple 192.0.2.10") {
  box.sh(`rm -f /tmp/appels-ssh /tmp/appels-journal /tmp/pirate /tmp/tmp.*
    cp ${F}/jail.local /etc/fail2ban/jail.local
    ${lines.length ? `printf '%s\\n' ${q(lines.join("\n"))}` : ":"} > /tmp/journal`);
  return box.sh(
    `${env} F2B_SSH=/fake/ssh PATH=/fake-vps:/fake:$PATH bash ${F}/eprouver-fail2ban.sh ${args}`,
  );
}

describe.skipIf(!docker)("the failures: the jail's count against the journal's", () => {
  it("a jail that counted failures since its start: ok, whatever the journal", () => {
    const r = trial([LINE.preauth]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/ok {4}la jail voit des echecs \(12 depuis son demarrage\)/);
    expect(r.out).toMatch(/actuellement bannies : 3/);
    expect(r.out).toMatch(/^4 reussies, 0 echouees$/m);
  });

  it("the jail counts none, the journal holds two: ECHEC, it reads the wrong place", () => {
    const r = trial(
      [LINE.invalid("203.0.113.6"), LINE.preauth, LINE.invalid("198.51.100.7")],
      "FAUX_ECHECS=0",
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC la jail ne compte AUCUN echec, le journal en porte 2/);
  });

  it("the 20/11 case: fresh start, only cut connections — nothing to judge, exit 3", () => {
    const r = trial([LINE.preauth, LINE.accepted], "FAUX_ECHECS=0");
    expect(r.code).toBe(3);
    expect(r.out).toMatch(
      /rien a juger : aucun echec au journal depuis le demarrage de fail2ban \(il y a 30 min\)/,
    );
    expect(r.out).toMatch(/^3 reussies, 0 echouees$/m);
    expect(r.out).toMatch(/a relancer plus tard/);
    expect(r.out).not.toMatch(/ECHEC/);
  });

  it.each([
    ["empty", []],
    ["only journalctl's « -- No entries -- »", ["-- No entries --"]],
  ])("a journal %s: zero, without asking fail2ban-regex — nothing to judge", (_w, lines) => {
    const r = trial(lines as string[], "FAUX_ECHECS=0 FAUX_SANS_REGEX=1");
    expect(r.code, r.out).toBe(3);
  });

  it("failures from the ignored address and the loopback alone: the jail rightly counts none", () => {
    const r = trial(
      [
        LINE.invalid("192.0.2.10"),
        LINE.invalid("127.0.0.1"),
        LINE.invalid("::1"),
        `${at} sshd[1005]: Invalid user x from 127.0.0.2`,
      ],
      "FAUX_ECHECS=0",
    );
    expect(r.code, r.out).toBe(3);
  });

  it("an address that only starts like the ignored one is no ignored address", () => {
    const r = trial([LINE.invalid("192.0.2.1"), LINE.invalid("192.0.2.100")], "FAUX_ECHECS=0");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/le journal en porte 2/);
  });

  it("an sshd-session line (OpenSSH 9.8 and later) is a failure too", () => {
    const r = trial([LINE.session("203.0.113.9")], "FAUX_ECHECS=0");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/le journal en porte 1/);
  });

  it("the journal is read from fail2ban's start, on both process names, not the jail's match", () => {
    trial([], "FAUX_ECHECS=0 FAUX_DEPUIS='Fri 2026-11-20 08:28:38 UTC'");
    const epoch = box.sh("date -d 'Fri 2026-11-20 08:28:38 UTC' +%s").out.trim();
    const call = box.sh("cat /tmp/appels-journal").out;
    const m = call.match(
      /^journalctl _COMM=sshd \+ _COMM=sshd-session --since @(\d+) --until @(\d+) -o short-iso\n$/,
    );
    expect(m, call).not.toBeNull();
    expect(m?.[1]).toBe(epoch);
    // Ten seconds before the jail's count is read: a failure still in flight is left out.
    const now = Number(box.sh("date +%s").out.trim());
    expect(now - Number(m?.[2])).toBeGreaterThanOrEqual(10);
    expect(now - Number(m?.[2])).toBeLessThan(30);
    expect(box.sh("ls /tmp/tmp.* 2>/dev/null").out).toBe("");
  });

  it.each([
    ["fail2ban's start unreadable", "FAUX_DEPUIS=n/a"],
    ["fail2ban's start empty", "FAUX_DEPUIS="],
    ["fail2ban-regex failing", "FAUX_ECHECS=0 FAUX_SANS_REGEX=1"],
    ["the jail's count unreadable", "FAUX_ECHECS=beaucoup"],
  ])("%s: ECHEC, never a pass by default", (_what, env) => {
    const r = trial([LINE.invalid("203.0.113.6")], env);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC les comptes sont illisibles/);
  });

  it("nothing to judge, but another check failing: the ECHEC wins, exit 1", () => {
    const r = trial([], "FAUX_ECHECS=0 FAUX_ACTIF=inactive");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC le service tourne/);
  });
});

describe.skipIf(!docker)("the other checks, as Legion wrote them", () => {
  it.each([
    ["", "192.0.2.10"],
    [" (written /32, as fail2ban never prints it)", "192.0.2.10/32"],
  ])("the ignored address%s: ok", (_w, address) => {
    const r = trial([LINE.preauth], "", `root@vps-exemple ${address}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/ok {4}l'appelant de la ronde est ignore/);
  });

  it.each([
    ["the service stopped", "192.0.2.10", "FAUX_ACTIF=inactive", /ECHEC le service tourne/],
    ["an address not ignored", "198.51.100.7", "", /ECHEC l'appelant de la ronde est ignore/],
    ["a prefix of an ignored address", "192.0.2.1", "", /ECHEC l'appelant de la ronde est ignore/],
  ])("%s: ECHEC, exit 1", (_what, address, env, said) => {
    const r = trial([LINE.preauth], env, `root@vps-exemple ${address}`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(said);
  });

  it("a jail.local without its backend line: ECHEC", () => {
    box.sh(`sed '/^backend/d' ${F}/jail.local > /tmp/sans-backend`);
    const r = box.sh(
      `cp /tmp/sans-backend /etc/fail2ban/jail.local; F2B_SSH=/fake/ssh PATH=/fake-vps:/fake:$PATH bash ${F}/eprouver-fail2ban.sh root@vps-exemple 192.0.2.10`,
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC la jail lit le journal/);
  });

  it.each([
    ["no address", "root@vps-exemple"],
    [
      "an address that would run a command",
      `root@vps-exemple ${q("192.0.2.10'; touch /tmp/pirate; '")}`,
    ],
  ])("%s: refused before any connection", (_what, args) => {
    const r = trial([], "", args);
    expect(r.code).not.toBe(0);
    expect(box.sh("cat /tmp/appels-ssh 2>/dev/null").out).toBe("");
    expect(box.sh("ls /tmp/pirate 2>/dev/null").out).toBe("");
  });
});
