// ADR-0045, H2: the self-repair of the USB network adapter, moved from the
// node itself (its 22/10 version, never brought back to Legion) — no trial
// existed. A fake /sys/class/net and a fake `ip` that does what it is told
// (or refuses, or does nothing): the card already in the bridge, out of it,
// back under another name found by its driver, a refused rename retried, the
// bridge missing (ifreload once, never twice), and every failure an exit 1
// that says why. The installer takes its jump and node as arguments, never
// written in the repository. Skipped without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const IP = `#!/bin/bash
# A fake ip: notes the call, and does it on the fake /sys unless told not to.
echo "ip $*" >> /tmp/appels
[ "$4" = "master" ] && [ -n "\${FAUX_MASTER_KO:-}" ] && exit 1
[ "$4" = "master" ] && [ -n "\${FAUX_MASTER_VIDE:-}" ] && exit 0
[ "$4" = "up" ] && [ -n "\${FAUX_UP_KO:-}" ] && exit 1
if [ "$4" = "name" ]; then
  if [ -f /tmp/renommage-ko ]; then rm -f /tmp/renommage-ko; exit 1; fi
  mv "$SYS/$3" "$SYS/$5"
fi
[ "$4" = "master" ] && ln -sfn "../$5" "$SYS/$3/master"
exit 0`;
const IFRELOAD = `#!/bin/bash
echo "ifreload $*" >> /tmp/appels
[ -n "\${FAUX_IFRELOAD_PONT:-}" ] && mkdir -p "$SYS/vmbr0"
exit 0`;

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  // The drivers' folders exist, as in a real /sys: a link to nothing is no driver.
  box.sh(
    `mkdir -p /drivers/cdc_ncm /drivers/r8169 /fake && printf '%s\\n' ${q(IP)} > /fake/ip && printf '%s\\n' ${q(IFRELOAD)} > /fake/ifreload && chmod 755 /fake/*`,
  );
}, 600_000);
afterAll(() => box?.stop());

/** A fake /sys/class/net: `layout` builds it; then one run, and the calls made. */
function run(layout: string, env = "") {
  box.sh(`rm -rf /tmp/sys /tmp/appels && mkdir -p /tmp/sys && cd /tmp/sys && ${layout || "true"}`);
  const r = box.sh(
    `${env} SYS=/tmp/sys ESSAIS=3 ATTENTE=0 PATH=/fake:$PATH bash /d/homelab/grappe/rebranchement/rebrancher-nic0`,
  );
  const calls = box.sh("cat /tmp/appels 2>/dev/null").out.trim().split("\n").filter(Boolean);
  return { ...r, calls };
}
const PONT = "mkdir vmbr0";
const CARTE = "mkdir -p nic0/device && ln -s /drivers/cdc_ncm nic0/device/driver";
const DANS_LE_PONT = "ln -s ../vmbr0 nic0/master";

describe.skipIf(!docker)("rebrancher-nic0 (the node's 22/10 version)", () => {
  it("a card already in the bridge: only reactivated, and the proof said", () => {
    const r = run(`${PONT} && ${CARTE} && ${DANS_LE_PONT}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/nic0 est deja dans vmbr0/);
    expect(r.calls).toEqual(["ip link set nic0 up"]);
    expect(r.out).toMatch(/^ok : nic0 dans vmbr0, activee$/m);
  });

  it("a card out of the bridge: put back, reactivated, proved", () => {
    const r = run(`${PONT} && ${CARTE}`);
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual(["ip link set nic0 master vmbr0", "ip link set nic0 up"]);
    expect(r.out).toMatch(/nic0 remise dans vmbr0/);
  });

  it("back as eth0: found by its driver, renamed nic0, put back", () => {
    const r = run(`${PONT} && mkdir -p eth0/device && ln -s /drivers/cdc_ncm eth0/device/driver`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/eth0 renommee en nic0/);
    expect(r.calls.slice(0, 2)).toEqual(["ip link set eth0 down", "ip link set eth0 name nic0"]);
  });

  it("a card of another driver is never taken for it", () => {
    const r = run(`${PONT} && mkdir -p eth0/device && ln -s /drivers/r8169 eth0/device/driver`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC : nic0 n'est pas apparue/);
    expect(r.calls.filter((c) => c.includes("name"))).toEqual([]);
  });

  it("a refused rename is said, and tried again", () => {
    box.sh("touch /tmp/renommage-ko");
    const r = run(`${PONT} && mkdir -p eth0/device && ln -s /drivers/cdc_ncm eth0/device/driver`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/renommage de eth0 en nic0 refuse, nouvel essai/);
    expect(r.out).toMatch(/eth0 renommee en nic0/);
  });

  it("the bridge missing: ifreload once, never twice, and the bridge comes back", () => {
    const back = run(CARTE, "FAUX_IFRELOAD_PONT=1");
    expect(back.code, back.out).toBe(0);
    expect(back.calls.filter((c) => c.startsWith("ifreload"))).toEqual(["ifreload -a"]);
    const never = run(CARTE);
    expect(never.code).toBe(1);
    expect(never.out).toMatch(/ECHEC : vmbr0 n'existe pas/);
    expect(never.calls.filter((c) => c.startsWith("ifreload"))).toHaveLength(1);
  });

  it.each([
    ["ip refuses the bridge", "FAUX_MASTER_KO=1", /refuse d'entrer dans vmbr0/],
    ["ip succeeds without effect", "FAUX_MASTER_VIDE=1", /n'est toujours pas dans vmbr0/],
    ["ip refuses to bring it up", "FAUX_UP_KO=1", /refuse de s'activer/],
  ])("%s: exit 1, said — never a silent failure", (_what, env, said) => {
    const r = run(`${PONT} && ${CARTE}`, env);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(said);
    expect(r.out).not.toMatch(/^ok :/m);
  });
});

describe.skipIf(!docker)("poser-rebranchement: its jump and node as arguments", () => {
  const SSH = `#!/bin/bash
echo "$(basename "$0") $*" >> /tmp/appels-ssh
cat > /dev/null
exit 0`;

  it.each([
    ["no argument", ""],
    ["one argument", "root@rebond-exemple"],
    ["a node without an account", "root@rebond-exemple noeud-exemple"],
    ["an option for an account", "-oProxyCommand=x root@noeud-exemple"],
    ["three arguments", "root@a root@b root@c"],
  ])("refuses %s, before any connection", (_what, args) => {
    box.sh(
      `mkdir -p /fakessh && printf '%s\\n' ${q(SSH)} > /fakessh/ssh && cp /fakessh/ssh /fakessh/scp && chmod 755 /fakessh/* && rm -f /tmp/appels-ssh`,
    );
    const r = box.sh(`PATH=/fakessh:$PATH bash /d/homelab/grappe/poser-rebranchement ${args}`);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage : poser-rebranchement <compte@rebond> <compte@noeud>/);
    expect(box.sh("cat /tmp/appels-ssh 2>/dev/null").out).toBe("");
  });

  it("copies the four files, the timer included, through the jump given", () => {
    box.sh("rm -f /tmp/appels-ssh");
    box.sh(
      "PATH=/fakessh:$PATH bash /d/homelab/grappe/poser-rebranchement root@rebond-exemple root@192.0.2.20",
    );
    const calls = box.sh("cat /tmp/appels-ssh").out;
    expect(calls).toMatch(
      /^scp -q -J root@rebond-exemple .*rebrancher-nic0\.timer root@192\.0\.2\.20:\/tmp\/$/m,
    );
    expect(calls).toMatch(/^ssh -J root@rebond-exemple root@192\.0\.2\.20 bash -s$/m);
  });
});
