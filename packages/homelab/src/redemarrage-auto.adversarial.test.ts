// ADR-0045, H3 (point 6 and its 19/11 precision): the public-site VPS's apt
// setting, moved AS IT IS ON THE SERVER — Automatic-Reboot "false" since 26/10,
// not Legion's "true". Read by the real apt-config, in a throwaway Debian with
// the real unattended-upgrades; and the real cenacle-maj-securite, the button
// declared for that VPS, accepts the machine — and refuses it the day the line
// goes back to "true". Skipped without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const FILE = "/d/homelab/redemarrage-auto/52legion-redemarrage";
const CONF = "/etc/apt/apt.conf.d";
// What the sites' installers write.
const PERIODIC = 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";';

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  // logger without syslog: what cenacle-maj-securite says, kept in a file.
  box.sh(
    `printf '%s\\n' ${q('#!/bin/bash\nshift 3; echo "$*" >> /tmp/journal')} > /usr/bin/logger && chmod 755 /usr/bin/logger`,
  );
}, 600_000);
afterAll(() => box?.stop());

/** The file posed as the README says, beside the installers' 20auto-upgrades. */
function pose(file = FILE) {
  box.sh(`rm -f ${CONF}/52legion-redemarrage /tmp/journal
    printf '%s\\n' ${q(PERIODIC)} > ${CONF}/20auto-upgrades
    install -m 644 -o root -g root ${file} ${CONF}/52legion-redemarrage`);
}
const reboot = () => box.sh("apt-config dump | grep Automatic-Reboot").out.trim().split("\n");
const majSecurite = () => box.sh("bash /d/serveurs/cenacle-maj-securite");

describe.skipIf(!docker)("52legion-redemarrage, the server's version", () => {
  it("its three settings are the server's, byte for byte", () => {
    const settings = box.sh(`grep -v '^//' ${FILE} | grep -v '^$'`).out;
    expect(settings).toBe(
      'Unattended-Upgrade::Automatic-Reboot "false";\n' +
        'Unattended-Upgrade::Automatic-Reboot-WithUsers "true";\n' +
        'Unattended-Upgrade::Automatic-Reboot-Time "03:30";\n',
    );
  });

  it("apt reads them: no reboot on its own, beside the installers' 20auto-upgrades", () => {
    pose();
    expect(reboot()).toEqual([
      'Unattended-Upgrade::Automatic-Reboot "false";',
      'Unattended-Upgrade::Automatic-Reboot-WithUsers "true";',
      'Unattended-Upgrade::Automatic-Reboot-Time "03:30";',
    ]);
  });

  it("read after Debian's own file: a reboot switched on there stays off", () => {
    pose();
    box.sh(
      `cp ${CONF}/50unattended-upgrades /tmp/50.avant && echo 'Unattended-Upgrade::Automatic-Reboot "true";' >> ${CONF}/50unattended-upgrades`,
    );
    try {
      expect(reboot()[0]).toBe('Unattended-Upgrade::Automatic-Reboot "false";');
    } finally {
      box.sh(`mv /tmp/50.avant ${CONF}/50unattended-upgrades`);
    }
  });
});

describe.skipIf(!docker)("the button declared for that VPS: cenacle-maj-securite", () => {
  it("accepts the machine: past the reboot check (no systemd-run here, so it stops at 12)", () => {
    pose();
    const r = majSecurite();
    expect(r.code).toBe(12);
    const said = box.sh("cat /tmp/journal").out;
    expect(said).not.toMatch(/redemarrer tout seul/);
    expect(said).toMatch(/echec: systemd-run/);
  });

  it('refuses it the day the line goes back to "true" — the 19/11 decision that was undone', () => {
    box.sh(`sed 's/Automatic-Reboot "false"/Automatic-Reboot "true"/' ${FILE} > /tmp/52-vrai`);
    pose("/tmp/52-vrai");
    const r = majSecurite();
    expect(r.code).toBe(11);
    expect(box.sh("cat /tmp/journal").out).toMatch(
      /refus: unattended-upgrade est regle pour redemarrer tout seul/,
    );
  });
});
