// ADR-0046, L1: the removal commands of deploy/homelab/retrait-legion/README.md,
// taken from the README itself and replayed, as root, on the real root of a
// throwaway Debian where Legion's traces were laid — then the inventory must say
// « rien ne reste », Cénacle's key lines and the kept pieces must still be there,
// and the guards must hold. Only the commands that need a real machine (systemd,
// pct, fstrim, launchctl) are left out or faked. Skipped without Docker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRACES } from "./retrait-legion-racines.ts";
import { type Box, buildImage, docker, q, ROOT, startBox } from "./test-homelab.ts";

const README = readFileSync(join(ROOT, "deploy", "homelab", "retrait-legion", "README.md"), "utf8");
const BLOCKS = [...README.matchAll(/^ *```bash\n([\s\S]*?)^ *```$/gm)].map((m) =>
  (m[1] ?? "").trim(),
);
const SCRIPT = "/d/homelab/retrait-legion/inventaire-legion";
const CENACLE_LINE =
  'command="/usr/local/bin/cenacle-bulletin",restrict ssh-ed25519 AAAAcenacle cenacle-ronde';

/** The one README block that begins with `start`. */
function block(start: string): string {
  const found = BLOCKS.filter((b) => b.startsWith(start));
  expect(found, start).toHaveLength(1);
  return found[0] ?? "";
}

const DEFINE = block("retirer_lignes_legion() {");
const UNITS = TRACES.filter(
  (t) => t.label.startsWith("unité ") && !t.label.includes("inattendue"),
).map((t) => t.label.slice("unité ".length));

let box: Box;
const sh = (command: string) => box.sh(command);

/** Fakes for what a container has not: systemd, visudo, a tailscale with Legion's proxy until it is turned off. */
const FAKES = [
  "printf '#!/bin/sh\\nexit 0\\n' > /usr/local/bin/systemctl",
  "printf '#!/bin/sh\\nexit 0\\n' > /usr/local/bin/visudo",
  `printf '%s\\n' '#!/bin/bash' 'case "$*" in' '  "serve status") if [ -e /tmp/ts-off ]; then echo "No serve config"; else echo "|-- / proxy http://127.0.0.1:8787"; fi ;;' '  "serve --https=443 off") touch /tmp/ts-off ;;' '  *) exit 2 ;;' 'esac' > /usr/local/bin/tailscale`,
  "chmod 755 /usr/local/bin/systemctl /usr/local/bin/visudo /usr/local/bin/tailscale",
];

/** A node that also carries Legion's container and backups: every trace, on the real root. */
const LAY = [
  "set -e; cd /",
  "useradd -m -u 1000 -s /bin/bash humain && useradd -m -u 1002 -s /bin/sh ronde && mkdir -p -m 700 home/humain/.ssh && chown humain: home/humain/.ssh",
  "mkdir -p root/.ssh etc/pve/priv etc/sudoers.d etc/needrestart/conf.d etc/systemd/system/timers.target.wants etc/apt/apt.conf.d etc/udev/rules.d",
  "ln -s /etc/pve/priv/authorized_keys root/.ssh/authorized_keys",
  ...TRACES.filter((t) => !["le compte ronde", "le dossier /home/ronde"].includes(t.label)).map(
    (t) => t.make,
  ),
  `echo ${q(CENACLE_LINE)} >> etc/pve/priv/authorized_keys`,
  "echo 'ssh-ed25519 AAAAhumain humain@poste' >> home/humain/.ssh/authorized_keys",
  "chown humain: home/humain/.ssh/authorized_keys && chmod 600 home/humain/.ssh/authorized_keys",
  "touch etc/needrestart/conf.d/zz-cenacle.conf etc/apt/apt.conf.d/52legion-redemarrage etc/udev/rules.d/90-legion-rebrancher-nic0.rules usr/local/bin/attendre-la-grappe",
  "mkdir -p root/storage/legion",
];

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  const faked = sh(FAKES.join(" && "));
  expect(faked.code, faked.err).toBe(0);
  const laid = sh(LAY.join("\n"));
  expect(laid.code, laid.err).toBe(0);
}, 600_000);
afterAll(() => box?.stop());

describe.skipIf(!docker)(
  "the README's removals, replayed on a real root (ADR-0046, L2 to L4)",
  { timeout: 120_000 },
  () => {
    it("before: the inventory finds Legion everywhere", () => {
      const run = sh(`bash ${SCRIPT}`);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toMatch(/^PRÉSENTE {2}le compte ronde$/m);
      expect(run.out).toMatch(/^PRÉSENTE {2}tailscale serve vers 127\.0\.0\.1:8787$/m);
      expect(run.out).toMatch(
        /^PRÉSENTE {2}authorized_keys de la grappe \(\/etc\/pve\/priv\) : 1 ligne/m,
      );
    });

    it("the preview shows each Legion line's last field, never its key", () => {
      const run = sh(
        block("grep -F -e ronde-legion").replace("<fichier>", "/etc/pve/priv/authorized_keys"),
      );
      expect(run.out.trim().split("\n")).toEqual(["veilleur-legion"]);
      expect(run.out).not.toContain("AAAA");
    });

    it("L2: the key lines go, Cénacle's stay, and files keep their link, owner and mode", () => {
      for (const f of [
        "/etc/pve/priv/authorized_keys",
        "/root/.ssh/authorized_keys2",
        "/home/humain/.ssh/authorized_keys",
        "/home/ronde/.ssh/authorized_keys",
      ]) {
        const run = sh(
          `${DEFINE}\n${block("retirer_lignes_legion <fichier>").replace("<fichier>", f)}`,
        );
        expect(run.code, `${f}: ${run.err}`).toBe(0);
      }
      expect(sh("cat /etc/pve/priv/authorized_keys").out).toBe(`${CENACLE_LINE}\n`);
      expect(sh("readlink /root/.ssh/authorized_keys").out.trim()).toBe(
        "/etc/pve/priv/authorized_keys",
      );
      expect(sh("stat -c '%U %a' /home/humain/.ssh/authorized_keys").out.trim()).toBe("humain 600");
      expect(sh("cat /home/humain/.ssh/authorized_keys").out).toBe(
        "ssh-ed25519 AAAAhumain humain@poste\n",
      );
      expect(sh("wc -c < /root/.ssh/authorized_keys2").out.trim()).toBe("0");
      expect(sh("ls /root/*.avant-legion | wc -l").out.trim()).toBe("4");
      expect(sh("ls /root/sans-legion.tmp").code).not.toBe(0);
    });

    it("run twice on a file, the helper refuses and the copy from before stays", () => {
      const run = sh(`${DEFINE}\nretirer_lignes_legion /etc/pve/priv/authorized_keys`);
      expect(run.code).not.toBe(0);
      expect(run.out).toMatch(/existe déjà : rien n'est fait/);
      expect(
        sh("grep -c veilleur-legion /root/_etc_pve_priv_authorized_keys.avant-legion").out.trim(),
      ).toBe("1");
      expect(sh("cat /etc/pve/priv/authorized_keys").out).toBe(`${CENACLE_LINE}\n`);
    });

    it("the helper refuses a file that is not there, and creates nothing", () => {
      const run = sh(`${DEFINE}\nretirer_lignes_legion /home/personne/.ssh/authorized_keys`);
      expect(run.code).not.toBe(0);
      expect(sh("ls /home/personne").code).not.toBe(0);
    });

    it("L2: the keys, the account, its sudo rules and the proxy go", () => {
      for (const start of [
        "rm -f /root/.ssh/ronde ",
        "rm -f /root/.ssh/veilleur-legion",
        "userdel -r ronde",
        "rm -f /etc/sudoers.d/",
        "tailscale serve status",
        "tailscale serve --https=443 off",
      ]) {
        const run = sh(block(start));
        expect(run.code, `${start}: ${run.err}`).toBe(0);
      }
      const run = sh(`bash ${SCRIPT}`);
      const l2 = run.out.slice(0, run.out.indexOf("== L3"));
      expect(l2, run.out).not.toMatch(/^(PRÉSENTE|ILLISIBLE)/m);
    });

    it("L3: legion.conf stays while zz-cenacle.conf is absent, and goes once it is there", () => {
      const guard = block("test -f /etc/needrestart/conf.d/zz-cenacle.conf");
      sh("mv /etc/needrestart/conf.d/zz-cenacle.conf /tmp/zz");
      sh(guard);
      expect(sh("test -e /etc/needrestart/conf.d/legion.conf").code).toBe(0);
      sh("mv /tmp/zz /etc/needrestart/conf.d/zz-cenacle.conf");
      expect(sh(guard).code).toBe(0);
      expect(sh("test -e /etc/needrestart/conf.d/legion.conf").code).not.toBe(0);
    });

    it("L3: the units, the files, the working folders go", () => {
      // The fake systemctl removes no activation link: the rm takes it, as `disable` would.
      const units = `${UNITS.join(" ")} legion-autre.service`;
      for (const command of [
        block("systemctl disable --now").replace("<unités présentes>", units),
        block("cd /etc/systemd/system && rm -rf --").replace(
          "<unités et surcharges présentes>",
          `${units} legion.service.d timers.target.wants/legion.timer`,
        ),
        block("rm -f /usr/local/bin/legion-bulletin-hote"),
        block("rm -rf /var/lib/legion-ronde"),
        block("rm -rf /var/lib/copie-bases"),
      ]) {
        const run = sh(command);
        expect(run.code, `${command}: ${run.err}`).toBe(0);
      }
    });

    it("L4: rmdir refuses a storage folder that holds anything else, and keeps it", () => {
      sh("echo autre > /root/storage/legion/autre-chose");
      const run = sh(block("rm -rf /root/projects/legion"));
      expect(run.code).not.toBe(0);
      expect(sh("cat /root/storage/legion/autre-chose").out).toBe("autre\n");
      expect(sh("test -e /root/storage/legion/.legion").code).not.toBe(0);
      sh("rm /root/storage/legion/autre-chose");
    });

    it("L4: the data go; then « rien ne reste », and the kept pieces are untouched", () => {
      sh(
        "mkdir -p /root/storage/legion/.legion && echo SECRETdonnee > /root/storage/legion/.legion/base",
      );
      for (const start of ["rm -rf /root/projects/legion", "rm -rf /var/backups/legion-bases"]) {
        const run = sh(block(start));
        expect(run.code, `${start}: ${run.err}`).toBe(0);
      }
      const run = sh(`bash ${SCRIPT}`);
      expect(run.code, run.out).toBe(0);
      expect(run.out.trim().split("\n").at(-1)).toBe("rien ne reste");
      for (const kept of [
        "/etc/needrestart/conf.d/zz-cenacle.conf",
        "/etc/apt/apt.conf.d/52legion-redemarrage",
        "/etc/udev/rules.d/90-legion-rebrancher-nic0.rules",
        "/usr/local/bin/attendre-la-grappe",
      ]) {
        expect(sh(`test -e ${kept}`).code, kept).toBe(0);
      }
    });

    it("every README command was either replayed here or needs a real machine", () => {
      const replayed =
        /^(retirer_lignes_legion|grep -F|rm |userdel|tailscale serve|test -f|systemctl disable|cd \/etc\/systemd)/;
      const machine = /^(bash inventaire-legion|pct |fstrim|for t in .* launchctl)/;
      expect(BLOCKS.filter((b) => !replayed.test(b) && !machine.test(b))).toEqual([]);
    });
  },
);
