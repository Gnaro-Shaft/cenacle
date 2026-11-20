// ADR-0045, H3: fail2ban on the VPS, moved from Legion — on the real fail2ban,
// in a throwaway Debian set back to Debian 12's defaults (the sshd jail reads
// /var/log/auth.log, absent there: the trap jail.local exists for). What it
// really loads; that a jail.d ignoreip REPLACES the list, and a second one
// silently wins (the 14/11 trap); the aggressive mode really loaded; every
// refusal of poser-fail2ban, the old jail.local put back. The trial lives in
// fail2ban-epreuve.adversarial.test.ts. No real address: 192.0.2.0/24,
// 198.51.100.0/24, 100.64.0.0/10. Skipped without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const F = "/d/homelab/fail2ban";
const FAKES: Record<string, string> = {
  // Runs the remote command here, as root; the last argument is the command.
  ssh: `echo "ssh $*" >> /tmp/appels-ssh; while [ $# -gt 1 ]; do shift; done; exec bash -c "$1"`,
  scp: `echo "scp $*" >> /tmp/appels-ssh
files=(); for a in "$@"; do [ "\${a#-}" = "$a" ] && files+=("$a"); done
dest="\${files[-1]#*:}"; unset 'files[-1]'; [ "\${dest#/}" = "$dest" ] && dest="$HOME/$dest"
cp "\${files[@]}" "$dest"
# Another account swapping the copy for a link, before root installs it.
[ -n "\${FAUX_LIEN:-}" ] && rm -f "$dest" && ln -s /etc/shadow "$dest"; true`,
  sudo: `[ "$1" = -n ] && shift; exec "$@"`,
  // No systemd in the box: the real server, started and stopped by hand.
  systemctl: `echo "systemctl $*" >> /tmp/appels
case "$1" in
  enable|restart) fail2ban-client stop >/dev/null 2>&1; fail2ban-client -x start >/dev/null 2>&1 ;;
  is-active) fail2ban-client ping >/dev/null 2>&1 && echo active || { echo inactive; exit 3; } ;;
esac`,
};
function fakes(dir: string, set: Record<string, string>) {
  for (const [name, body] of Object.entries(set)) {
    box.sh(`mkdir -p ${dir} && printf '%s\\n' ${q(`#!/bin/bash\n${body}`)} > ${dir}/${name}`);
  }
  box.sh(`chmod 755 ${dir}/*`);
}

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  fakes("/fake", FAKES);
}, 600_000);
afterAll(() => box?.stop());

/** fail2ban stopped, nothing posed, Debian 12's defaults: the jail would read a file. */
function reset() {
  box.sh(`fail2ban-client stop >/dev/null 2>&1; rm -rf /tmp/appels /tmp/appels-ssh /root/jail.local.cenacle /tmp/f2b /etc/fail2ban/jail.local /etc/fail2ban/jail.d/*
    printf '[sshd]\\nenabled = true\\n' > /etc/fail2ban/jail.d/defaults-debian.conf
    sed -i 's/^sshd_backend = .*/sshd_backend = %(default_backend)s/' /etc/fail2ban/paths-debian.conf
    rm -f /var/log/auth.log; true`);
}
const ignorer = (body?: string) =>
  box.sh(
    body === undefined
      ? `cp ${F}/ignorer.exemple.local /etc/fail2ban/jail.d/ignorer.local`
      : `printf '%s\\n' ${q(body)} > /etc/fail2ban/jail.d/ignorer.local`,
  );
const dump = () => box.sh("fail2ban-client -d 2>&1").out;
const ignored = () => dump().match(/^\['set', 'sshd', 'addignoreip'.*$/m)?.[0];
const poser = (args = "root@vps-exemple", script = `${F}/poser-fail2ban`) =>
  box.sh(`ATTENTE_F2B=10 PATH=/fake:$PATH bash ${script} ${args}`);
const posed = () => box.sh("cat /etc/fail2ban/jail.local 2>/dev/null").out;
const running = () => box.sh("fail2ban-client ping >/dev/null 2>&1").code === 0;

describe.skipIf(!docker)("the configuration fail2ban really loads", () => {
  it("with Debian 12's defaults: the sshd jail reads the journal, with Legion's thresholds", () => {
    reset();
    box.sh(`cp ${F}/jail.local /etc/fail2ban/`);
    ignorer();
    const d = dump();
    expect(d).toMatch(/^\['add', 'sshd', 'systemd'\]$/m);
    for (const line of [
      "'maxretry', 4",
      "'findtime', '10m'",
      "'bantime', '1h'",
      "'bantime.increment', True",
      "'bantime.factor', '2'",
      "'bantime.maxtime', '1w'",
    ]) {
      expect(d).toContain(`['set', 'sshd', ${line}]`);
    }
  });

  it("without its backend line, the same defaults would read a file: the trap is real here", () => {
    reset();
    box.sh(`sed '/^backend/d' ${F}/jail.local > /etc/fail2ban/jail.local`);
    expect(dump()).toMatch(/^\['add', 'sshd', 'auto'\]$/m);
  });

  // A cut before authentication — all a key-only robot leaves — counts as a
  // failure in aggressive mode only: in normal mode its rule is « NOFAIL ».
  const PREAUTH_FAILS = "'^<F-MLFFORGET>(?:Connection (?:closed|reset)";
  const PREAUTH_NOFAIL = "'^<F-NOFAIL><F-MLFFORGET>(?:Connection (?:closed|reset)";

  it("the sshd jail in aggressive mode: a cut [preauth] is a failure, and the ddos rules load", () => {
    reset();
    box.sh(`cp ${F}/jail.local /etc/fail2ban/`);
    ignorer();
    const d = dump();
    expect(d).toContain(PREAUTH_FAILS);
    expect(d).toContain("kex_exchange_identification");
    // Aggressive, not ddos alone: the « extra » rules come with it.
    expect(d).toContain("authentication methods available");
  });

  it("without its mode line, the same jail.local is back to normal: the cut is no failure", () => {
    reset();
    box.sh(`sed '/^mode = /d' ${F}/jail.local > /etc/fail2ban/jail.local`);
    const d = dump();
    expect(d).not.toContain(PREAUTH_FAILS);
    expect(d).toContain(PREAUTH_NOFAIL);
    expect(d).not.toContain("kex_exchange_identification");
    expect(d).not.toContain("authentication methods available");
  });

  it("jail.local alone ignores the machine itself, and no address is written in it", () => {
    reset();
    box.sh(`cp ${F}/jail.local /etc/fail2ban/`);
    expect(ignored()).toBe("['set', 'sshd', 'addignoreip', '127.0.0.1/8', '::1']");
    const text = box.sh(`grep -v '^#' ${F}/jail.local`).out;
    expect(text.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual(["127.0.0.1"]);
  });

  it("ignorer.local replaces jail.local's list, whole — localhost included", () => {
    reset();
    box.sh(`cp ${F}/jail.local /etc/fail2ban/`);
    ignorer();
    expect(ignored()).toBe(
      "['set', 'sshd', 'addignoreip', '127.0.0.1/8', '::1', '192.0.2.10', '100.64.0.10']",
    );
  });

  it("two jail.d files with an ignoreip: the last read wins, silently — what poser refuses", () => {
    reset();
    box.sh(`cp ${F}/jail.local /etc/fail2ban/`);
    ignorer();
    box.sh(
      "printf '[sshd]\\nignoreip = 127.0.0.1/8 ::1 198.51.100.7\\n' > /etc/fail2ban/jail.d/zz.local",
    );
    expect(ignored()).toBe("['set', 'sshd', 'addignoreip', '127.0.0.1/8', '::1', '198.51.100.7']");
  });
});

describe.skipIf(!docker)("poser-fail2ban", () => {
  it.each([
    ["no argument", ""],
    ["two arguments", "root@a root@b"],
    ["an option for an account", "-oProxyCommand=x"],
    ["a VPS without an account", "vps-exemple"],
  ])("refuses %s, before any connection", (_what, args) => {
    reset();
    const r = poser(args);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage : poser-fail2ban <compte@vps>/);
    expect(box.sh("cat /tmp/appels-ssh 2>/dev/null").out).toBe("");
  });

  it.each([
    ["no ignorer.local", null, /ignorer\.local absent/],
    [
      "an ignorer.local with the machine itself only",
      "[sshd]\nignoreip = 127.0.0.1/8 ::1",
      /n'ignore que la machine elle-meme/,
    ],
    [
      "an ignorer.local with the machine itself, written otherwise",
      "[sshd]\nignoreip = 127.0.0.1, 127.0.0.0/8 localhost ::1/128",
      /n'ignore que la machine elle-meme/,
    ],
    [
      "an ignorer.local without any ignoreip",
      "[sshd]\nmaxretry = 4",
      /n'ignore que la machine elle-meme/,
    ],
  ])("%s: refused, nothing touched", (_what, body, said) => {
    reset();
    if (body !== null) ignorer(body);
    const r = poser();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(said);
    expect(posed()).toBe("");
    expect(box.sh("cat /tmp/appels 2>/dev/null").out).not.toMatch(/systemctl/);
    expect(box.sh("ls /root/jail.local.cenacle 2>/dev/null").out).toBe("");
  });

  it("the copy swapped for a link before root installs it: refused, nothing touched", () => {
    reset();
    ignorer();
    const r = box.sh(`FAUX_LIEN=1 PATH=/fake:$PATH bash ${F}/poser-fail2ban root@vps-exemple`);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/le jail\.local copie n'est pas un fichier de root/);
    expect(posed()).toBe("");
  });

  it("an ignoreip separated by commas, as fail2ban allows: read, not refused", () => {
    reset();
    ignorer("[sshd]\nignoreip = 127.0.0.1/8, ::1, 192.0.2.10");
    const r = poser();
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/1 adresse\(s\) a ignorer/);
  });

  it.each([
    ["the 14/11 file", "cenacle-mac.local", "[sshd]\nignoreip = 127.0.0.1/8 ::1 100.64.0.10"],
    ["a .conf, under DEFAULT", "autre.conf", "[DEFAULT]\n  ignoreip=198.51.100.7"],
  ])(
    "another jail.d file with an ignoreip (%s): refused, named, nothing touched",
    (_w, name, body) => {
      reset();
      ignorer();
      box.sh(`printf '%s\\n' ${q(body)} > /etc/fail2ban/jail.d/${name}`);
      const r = poser();
      expect(r.code).toBe(1);
      expect(r.err).toContain(`un autre fichier pose un ignoreip`);
      expect(r.err).toContain(`/etc/fail2ban/jail.d/${name}`);
      expect(posed()).toBe("");
      expect(running()).toBe(false);
    },
  );

  it("posed as in the repository; running, reading the journal, ignoring each address", () => {
    reset();
    ignorer();
    const r = poser();
    expect(r.code, r.out + r.err).toBe(0);
    expect(box.sh(`cmp ${F}/jail.local /etc/fail2ban/jail.local`).code).toBe(0);
    expect(box.sh("stat -c %a /etc/fail2ban/jail.local").out.trim()).toBe("644");
    expect(r.out).toMatch(/2 adresse\(s\) a ignorer, dans ignorer\.local seul/);
    expect(r.out).toMatch(/la jail sshd lit le journal de systemd/);
    expect(r.out).toMatch(/chaque adresse de ignorer\.local est ignoree/);
    expect(running()).toBe(true);
    // A set: its order changes from one start to the next, and the last line is « `- ».
    expect(box.sh("fail2ban-client get sshd ignoreip").out).toMatch(/^[|`]- 192\.0\.2\.10$/m);
    expect(box.sh("ls /root/jail.local.cenacle /tmp/tmp.* 2>/dev/null").out).toBe("");
    expect(box.sh("cat /tmp/appels-ssh").out).toMatch(
      /^scp -q \S+\/jail\.local root@vps-exemple:jail\.local\.cenacle$/m,
    );
  });

  it("an address written /32 is the one fail2ban shows bare: not a false refusal", () => {
    reset();
    ignorer("[sshd]\nignoreip = 127.0.0.1/8 ::1 100.64.0.10/32 2001:db8::7/128 192.0.2.0/24");
    const r = poser();
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/3 adresse\(s\)/);
  });

  it("an address fail2ban rewrites (host bits in a network) is said, never passed for ignored", () => {
    reset();
    ignorer("[sshd]\nignoreip = 127.0.0.1/8 ::1 192.0.2.5/24");
    const r = poser();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(
      /fail2ban n'ignore pas une adresse de ignorer\.local \(192\.0\.2\.5\/24\)/,
    );
    expect(r.err).toMatch(/l'ancien jail\.local est remis/);
  });

  it("a jail.local that forgets the journal: refused after the start, the old one put back", () => {
    reset();
    ignorer();
    box.sh("printf '# ancien\\n[DEFAULT]\\nbackend = systemd\\n' > /etc/fail2ban/jail.local");
    box.sh(`cp -r ${F} /tmp/f2b && sed -i '/^backend/d' /tmp/f2b/jail.local`);
    const r = poser("root@vps-exemple", "/tmp/f2b/poser-fail2ban");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/l'ancien jail\.local est remis/);
    expect(posed()).toBe("# ancien\n[DEFAULT]\nbackend = systemd\n");
  });

  it("forgetting the journal where an auth.log exists: it starts, reads a file — refused", () => {
    reset();
    ignorer();
    box.sh(
      `touch /var/log/auth.log && cp -r ${F} /tmp/f2b && sed -i '/^backend/d' /tmp/f2b/jail.local`,
    );
    const r = poser("root@vps-exemple", "/tmp/f2b/poser-fail2ban");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/la jail sshd ne lit pas le journal de systemd/);
    expect(posed()).toBe("");
  });

  it("a single address, so the list's last line (« `- »): read, not refused", () => {
    reset();
    ignorer("[sshd]\nignoreip = 192.0.2.10");
    const r = poser();
    expect(r.code, r.out + r.err).toBe(0);
    expect(box.sh("fail2ban-client get sshd ignoreip").out).toMatch(/^`- 192\.0\.2\.10$/m);
  });

  it("fail2ban refusing to start: the old jail.local put back, none if there was none", () => {
    reset();
    ignorer("[sshd]\nignoreip = 127.0.0.1/8 ::1 192.0.2.10\nmaxretry = quatre");
    const r = poser();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/l'ancien jail\.local est remis/);
    expect(posed()).toBe("");
  });
});
