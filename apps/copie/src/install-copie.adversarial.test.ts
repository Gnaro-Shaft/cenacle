// ADR-0044, points 4, 5 and 10: deploy/serveurs/install-copie.sh, run for real
// in a throwaway Debian, then the whole chain: a copy encrypted by the real
// age, pushed by the real rsync through the key locked on rrsync, filed and
// judged by the watcher. The account has no password, no group, no sudo; its
// lock (authorized_keys) is root's; the store's folders are set exactly; a
// second run changes nothing and keeps the key's line. Refused: run by
// another than root, rrsync missing, the account in another group, a folder
// of the store made a link. Skipped where Docker is absent (the CI).
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findTool, isRealRsync, TOOLS } from "./export.ts";
import { rsyncArgs, runPush } from "./pousser.ts";
import { buildImage, docker, type Node, STATE, STORE, startNode, WATCHER } from "./test-depot.ts";

const DIR = mkdtempSync(join(tmpdir(), "cenacle-depot-"));
const KEY = join(DIR, "pousser");
const ACCOUNT = "cenacle-depot";
let node: Node;
let install: { code: number; out: string };

beforeAll(() => {
  if (!docker) return;
  buildImage();
  node = startNode(true);
  install = node.sh("/d/install-copie.sh");
}, 600_000);
afterAll(() => {
  node?.stop();
  rmSync(DIR, { recursive: true, force: true });
});

const stat = (path: string) => node.sh(`stat -c '%U:%G %a' ${path}`).out.trim();

describe.skipIf(!docker)("install-copie.sh on the backup node", () => {
  it("creates a locked account: its own group alone, a shell for rrsync, no password", () => {
    expect(install.code, install.out).toBe(0);
    expect(node.sh(`id -Gn ${ACCOUNT}`).out.trim()).toBe(ACCOUNT);
    expect(node.sh(`getent passwd ${ACCOUNT} | cut -d: -f6,7`).out.trim()).toBe(
      `/home/${ACCOUNT}:/bin/sh`,
    );
    expect(node.sh(`passwd -S ${ACCOUNT}`).out.split(" ")[1]).toBe("L");
  });

  it("its lock is root's: the key cannot change the line that binds it", () => {
    expect(stat(`/home/${ACCOUNT}`)).toBe("root:root 755");
    expect(stat(`/home/${ACCOUNT}/.ssh`)).toBe("root:root 755");
    expect(stat(`/home/${ACCOUNT}/.ssh/authorized_keys`)).toBe("root:root 644");
    expect(node.sh(`echo x >> /home/${ACCOUNT}/.ssh/authorized_keys`, ACCOUNT).code).not.toBe(0);
  });

  it("sets the store exactly: the arrival the account's, the rest root's alone", () => {
    expect(stat(STORE)).toBe("root:root 711");
    expect(stat(`${STORE}/arrivee`)).toBe(`${ACCOUNT}:${ACCOUNT} 700`);
    for (const d of ["examen", "gardees", "refusees"])
      expect(stat(`${STORE}/${d}`)).toBe("root:root 700");
    expect(stat(STATE)).toBe("root:root 755");
    expect(stat(WATCHER)).toBe("root:root 755");
    for (const d of ["examen", "gardees", "refusees"]) {
      expect(node.sh(`ls ${STORE}/${d}`, ACCOUNT).code, d).not.toBe(0);
    }
  });

  it("enables the timer and runs a first pass by its unit: no copy yet, said", () => {
    const calls = node.sh("cat /var/log/systemctl-stub").out.trim().split("\n");
    expect(calls).toEqual([
      "daemon-reload",
      "enable --now veiller-copie-cenacle.timer",
      "start veiller-copie-cenacle.service",
    ]);
    expect(node.sh(`cat ${STATE}/verdict`).out).toMatch(/motif=aucune copie gardée/);
    for (const unit of ["service", "timer"]) {
      const placed = node.sh(`cat /etc/systemd/system/veiller-copie-cenacle.${unit}`).out;
      expect(placed).toBe(node.sh(`cat /d/veiller-copie-cenacle.${unit}`).out);
    }
    expect(install.out).toMatch(
      /rrsync -wo -no-del -no-overwrite \/var\/backups\/cenacle-copie\/arrivee/,
    );
  });

  it("a second run changes nothing, and keeps the key's line and the copies", () => {
    node.sh(
      `echo 'restrict,command="x" ssh-ed25519 AAAA essai' > /home/${ACCOUNT}/.ssh/authorized_keys; touch ${STORE}/gardees/garde`,
    );
    const again = node.sh("/d/install-copie.sh");
    expect(again.code, again.out).toBe(0);
    expect(node.sh(`cat /home/${ACCOUNT}/.ssh/authorized_keys`).out).toMatch(/essai/);
    expect(stat(`/home/${ACCOUNT}/.ssh/authorized_keys`)).toBe("root:root 644");
    expect(node.sh(`ls ${STORE}/gardees`).out).toMatch(/garde/);
    node.sh(`rm ${STORE}/gardees/garde`);
  });

  it.each([
    ["run by another than root", "", "", "nobody", /Run as root/],
    [
      "rrsync missing",
      "mv /usr/bin/rrsync /root/rrsync",
      "mv /root/rrsync /usr/bin/rrsync",
      "",
      /rrsync is missing/,
    ],
    [
      "the account in another group",
      `usermod -aG users ${ACCOUNT}`,
      `gpasswd -d ${ACCOUNT} users`,
      "",
      /another group/,
    ],
    [
      "a folder of the store made a link",
      `mv ${STORE}/gardees /root/g && ln -s /root/g ${STORE}/gardees`,
      `rm ${STORE}/gardees && mv /root/g ${STORE}/gardees`,
      "",
      /is a link/,
    ],
  ])("refuses: %s", (_what, breakIt, mend, user, said) => {
    node.sh(breakIt);
    const run = node.sh("/d/install-copie.sh", user || undefined);
    node.sh(mend);
    expect(run.code).not.toBe(0);
    expect(run.out).toMatch(said);
  });
});

describe.skipIf(!docker)("the store's root, a link to a volume of its own", () => {
  it("is accepted: the folders and the copies land on the volume", () => {
    node.sh(`rm -rf ${STORE} && install -d -m 0711 /srv/volume && ln -s /srv/volume ${STORE}`);
    const run = node.sh("/d/install-copie.sh");
    expect(run.code, run.out).toBe(0);
    expect(stat("/srv/volume/arrivee")).toBe(`${ACCOUNT}:${ACCOUNT} 700`);
    node.sh(
      `printf 'age-encryption.org/v1\\nx' > ${STORE}/arrivee/cenacle-2026-11-18-00000000000000bb.age && chown -R ${ACCOUNT}: ${STORE}/arrivee`,
    );
    expect(node.sh(WATCHER).code).toBe(0);
    expect(node.sh("ls /srv/volume/gardees").out).toMatch(/00000000000000bb\.age/);
    node.sh(`find /srv/volume/gardees -mindepth 1 -delete`);
  });
});

describe.skipIf(!docker)("the whole chain: age, the push key on rrsync, the watcher", () => {
  const age = findTool(TOOLS.age);
  const rsync = findTool(TOOLS.rsync, isRealRsync);

  it.skipIf(age === null || rsync === null)(
    "a real copy arrives, is kept whole, and the verdict is SAIN",
    async () => {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", KEY]);
      chmodSync(KEY, 0o600);
      const line = `restrict,command="/usr/bin/rrsync -wo -no-del -no-overwrite ${STORE}/arrivee" ${readFileSync(`${KEY}.pub`, "utf8").trim()}`;
      node.sh(`printf '%s\\n' '${line}' > /home/${ACCOUNT}/.ssh/authorized_keys`);
      node.sh("ssh-keygen -A >/dev/null && /usr/sbin/sshd");
      const port = Number(
        execFileSync("docker", ["port", node.name, "22/tcp"], { encoding: "utf8" })
          .trim()
          .split(":")
          .pop(),
      );
      const host = node.sh("cat /etc/ssh/ssh_host_ed25519_key.pub").out.trim().split(" ");
      writeFileSync(join(DIR, "known_hosts"), `[127.0.0.1]:${port} ${host[0]} ${host[1]}\n`);

      const identity = join(DIR, "identite");
      execFileSync(`${age}-keygen`, ["-o", identity], { stdio: "ignore" });
      const recipient = execFileSync(`${age}-keygen`, ["-y", identity], {
        encoding: "utf8",
      }).trim();
      const plain = join(DIR, "clair");
      writeFileSync(plain, "quatre tables, pour l'essai\n");
      const file = join(DIR, "cenacle-2026-11-18-00000000000000aa.age");
      execFileSync(age as string, ["-r", recipient, "-o", file, plain]);
      const config = {
        recipient,
        knownHosts: join(DIR, "known_hosts"),
        address: "127.0.0.1",
        port,
        account: ACCOUNT,
      };
      expect(await runPush(rsync as string, rsyncArgs(config, KEY, file))).toBe(0);

      expect(node.sh(WATCHER).code).toBe(0);
      const kept = node.sh(`ls ${STORE}/gardees`).out.trim();
      expect(kept).toMatch(/^[1-9][0-9]*-cenacle-2026-11-18-00000000000000aa\.age$/);
      const back = join(DIR, "relue.age");
      writeFileSync(
        back,
        execFileSync("docker", ["exec", node.name, "cat", `${STORE}/gardees/${kept}`]),
      );
      expect(execFileSync(age as string, ["-d", "-i", identity, back], { encoding: "utf8" })).toBe(
        "quatre tables, pour l'essai\n",
      );
      expect(node.sh(`cat ${STATE}/verdict`).out).toMatch(/^verdict=SAIN$/m);
    },
    120_000,
  );
});
