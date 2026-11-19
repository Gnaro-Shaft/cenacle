// ADR-0045, H2: the cluster's administration scripts, moved from Legion as
// they are — run by hand over ssh, never installed; no trial existed. Each runs
// on a fake root (RACINE) or in the throwaway container, with fake apt, pvecm,
// systemctl, qm, pct: what it writes, what it keeps aside, and above all what
// it refuses — no signing key, no quorum, a dirty dpkg, needrestart that would
// restart services, a phase it does not know, a guest marked onboot left
// stopped. Skipped without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const G = "/d/homelab/grappe";
const FAKES: Record<string, string> = {
  "apt-get": `case "$*" in
  update) printf '%s\\n' "\${FAUX_UPDATE:-Hit:1 http://download.proxmox.com/debian/pve trixie InRelease}" ;;
  "-s dist-upgrade") printf '%b' "\${FAUX_RESTE:-}" ;;
  *dist-upgrade*) echo "Setting up pve-manager" ;;
esac`,
  "apt-cache": `echo "  500 http://download.proxmox.com/debian/pve trixie/pve-no-subscription amd64 Packages"`,
  pvecm: `echo "Quorate:          \${FAUX_QUORUM:-Yes}"`,
  dpkg: `[ "$1" = --audit ] && printf '%s' "\${FAUX_AUDIT:-}"; exit 0`,
  "systemd-run": `echo "systemd-run $*" >> /tmp/appels; while [ "\${1#--}" != "$1" ]; do shift; done; exec "$@"`,
  uname: `echo "\${FAUX_NOYAU:-6.8.12-4-pve}"`,
  qm: `case "$1" in list) printf '%b' "\${FAUX_QM:-      VMID NAME STATUS\\n}" ;; config) printf '%b' "\${FAUX_QM_CONFIG:-}" ;; esac`,
  pct: `case "$1" in list) printf '%b' "\${FAUX_PCT:-VMID       Status\\n}" ;; config) printf '%b' "\${FAUX_PCT_CONFIG:-}" ;; esac`,
  systemctl: `echo "systemctl $*" >> /tmp/appels; [ "$1" = is-enabled ] && echo "\${FAUX_ETAT:-masked}"; exit 0`,
  journalctl: "exit 0",
  "systemd-analyze": `[ -n "\${FAUX_ANALYSE:-}" ] && { echo "$FAUX_ANALYSE"; exit 0; }; cat /etc/systemd/logind.conf.d/*.conf`,
};

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  for (const [name, body] of Object.entries(FAKES)) {
    box.sh(`mkdir -p /fake && printf '%s\\n' ${q(`#!/bin/bash\n${body}`)} > /fake/${name}`);
  }
  box.sh("chmod 755 /fake/*");
}, 600_000);
afterAll(() => box?.stop());

/** A fresh fake root: Debian trixie, the Proxmox key, an enterprise source of each kind. */
function root(key = true) {
  box.sh(`rm -rf /tmp/r /tmp/appels && mkdir -p /tmp/r/etc/apt/sources.list.d /tmp/r/usr/share/keyrings /tmp/r/root /tmp/r/boot
    echo VERSION_CODENAME=trixie > /tmp/r/etc/os-release
    ${key ? "echo cle > /tmp/r/usr/share/keyrings/proxmox-archive-keyring.gpg" : "true"}
    printf 'Types: deb\\nURIs: https://enterprise.proxmox.com/debian/pve\\nSuites: trixie\\nComponents: pve-enterprise\\n' > /tmp/r/etc/apt/sources.list.d/pve-enterprise.sources
    printf 'deb https://enterprise.proxmox.com/debian/ceph-squid trixie enterprise\\n' > /tmp/r/etc/apt/sources.list.d/ceph.list
    touch /tmp/r/boot/vmlinuz-6.8.12-4-pve`);
}
const run = (script: string, env = "", args = "") =>
  box.sh(`${env} RACINE=/tmp/r PATH=/fake:$PATH bash ${G}/${script} ${args}`);
const read = (path: string) => box.sh(`cat /tmp/r${path}`).out;

describe.skipIf(!docker)("depot-sans-abonnement", () => {
  it("no signing key: refused, nothing touched", () => {
    root(false);
    const r = run("depot-sans-abonnement");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/cle Proxmox absente/);
    expect(read("/etc/apt/sources.list.d/pve-enterprise.sources")).not.toMatch(/Enabled/);
  });

  it("turns the enterprise sources off (kept, not deleted), adds pve-no-subscription for the suite", () => {
    root();
    const r = run("depot-sans-abonnement");
    expect(r.code, r.out + r.err).toBe(0);
    expect(read("/etc/apt/sources.list.d/pve-enterprise.sources")).toMatch(
      /^Types: deb\nEnabled: no\n/,
    );
    expect(read("/etc/apt/sources.list.d/ceph.list")).toMatch(/^# deb https:\/\/enterprise/);
    expect(read("/etc/apt/sources.list.d/proxmox.sources")).toMatch(
      /^Suites: trixie\nComponents: pve-no-subscription$/m,
    );
    expect(box.sh("ls /tmp/r/root/depots-avant-*/").out).toMatch(/pve-enterprise\.sources/);
    expect(r.out).toMatch(/pve-manager est propose par pve-no-subscription/);
  });

  it("run twice: nothing doubled", () => {
    root();
    run("depot-sans-abonnement");
    const again = run("depot-sans-abonnement");
    expect(again.out).toMatch(/pve-no-subscription deja declare/);
    const sources = read("/etc/apt/sources.list.d/pve-enterprise.sources");
    expect(sources.match(/Enabled: no/g)).toHaveLength(1);
  });

  it("apt-get update with an error: said, never passed for done", () => {
    root();
    const r = run("depot-sans-abonnement", "FAUX_UPDATE='Err:1 http://download.proxmox.com 401'");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/apt-get update rend des erreurs/);
  });
});

describe.skipIf(!docker)("mettre-a-jour-un-noeud", () => {
  it.each([
    ["no phase", "", /phase attendue/],
    ["an unknown phase", "toutes", /phase inconnue/],
  ])("%s: refused", (_what, args, said) => {
    root();
    const r = run("mettre-a-jour-un-noeud", "", args);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(said);
  });

  it.each([
    ["no quorum", "FAUX_QUORUM=No", /n'a pas son quorum/],
    ["dpkg interrupted", "FAUX_AUDIT='paquet a moitie configure'", /dpkg n'est pas propre/],
  ])("appliquer refuses %s, before any upgrade", (_what, env, said) => {
    root();
    const r = run("mettre-a-jour-un-noeud", env, "appliquer");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(said);
    expect(box.sh("cat /tmp/appels 2>/dev/null").out).not.toMatch(/systemd-run/);
  });

  it("appliquer refuses a needrestart that would restart services", () => {
    root();
    box.sh(
      "mkdir -p /tmp/r/etc/needrestart && echo \"\\$nrconf{restart} = 'a';\" > /tmp/r/etc/needrestart/needrestart.conf",
    );
    const r = run("mettre-a-jour-un-noeud", "", "appliquer");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/needrestart est installe sans/);
  });

  it("appliquer upgrades detached from the session, and says a newer kernel waits", () => {
    root();
    box.sh("touch /tmp/r/boot/vmlinuz-6.8.12-5-pve");
    const r = run("mettre-a-jour-un-noeud", "", "appliquer");
    expect(r.code, r.out + r.err).toBe(0);
    expect(box.sh("cat /tmp/appels").out).toMatch(
      /^systemd-run --unit=legion-maj-\d{8}-\d{6} --wait/m,
    );
    expect(r.out).toMatch(
      /A FAIRE {2}redemarrer : 6\.8\.12-5-pve installe, 6\.8\.12-4-pve en marche/,
    );
  });

  it("appliquer refuses when packages are left to upgrade", () => {
    root();
    const r = run(
      "mettre-a-jour-un-noeud",
      "FAUX_RESTE='Inst pve-manager [8.1] (8.2 x)\\n'",
      "appliquer",
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/1 paquet\(s\) restent/);
  });

  it("retour refuses a kernel that is not the newest, and a guest onboot left stopped", () => {
    root();
    box.sh("touch /tmp/r/boot/vmlinuz-6.8.12-5-pve");
    const old = run("mettre-a-jour-un-noeud", "", "retour");
    expect(old.code).toBe(1);
    expect(old.err).toMatch(/le noyau en marche est 6\.8\.12-4-pve, pas 6\.8\.12-5-pve/);
    root();
    const stopped = run(
      "mettre-a-jour-un-noeud",
      "FAUX_PCT='VMID       Status\\n200        stopped\\n' FAUX_PCT_CONFIG='onboot: 1\\n'",
      "retour",
    );
    expect(stopped.code).toBe(1);
    expect(stopped.err).toMatch(/onboot mais arrete\(s\) : pct\/200/);
    const fine = run("mettre-a-jour-un-noeud", "", "retour");
    expect(fine.code, fine.out + fine.err).toBe(0);
  });
});

describe.skipIf(!docker)("ignorer-le-capot", () => {
  it("writes logind's three lid settings to ignore, masks sleep, and proves both", () => {
    const r = box.sh(`rm -f /tmp/appels; PATH=/fake:$PATH bash ${G}/ignorer-le-capot`);
    expect(r.code, r.out + r.err).toBe(0);
    const conf = box.sh("cat /etc/systemd/logind.conf.d/serveur-capot.conf").out;
    expect(conf).toMatch(/^\[Login\]$/m);
    for (const key of [
      "HandleLidSwitch",
      "HandleLidSwitchExternalPower",
      "HandleLidSwitchDocked",
    ]) {
      expect(conf).toMatch(new RegExp(`^${key}=ignore$`, "m"));
    }
    expect(conf).not.toMatch(/deploiement\//);
    expect(box.sh("cat /tmp/appels").out).toMatch(
      /^systemctl mask --quiet sleep\.target suspend\.target hibernate\.target hybrid-sleep\.target$/m,
    );
  });

  it.each([
    ["logind still suspending", "FAUX_ANALYSE='HandleLidSwitch=suspend'", /HandleLidSwitch vaut/],
    ["suspend not masked", "FAUX_ETAT=enabled", /suspend\.target est « enabled »/],
  ])("%s: said, exit 1", (_what, env, said) => {
    const r = box.sh(`${env} PATH=/fake:$PATH bash ${G}/ignorer-le-capot`);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(said);
  });
});
