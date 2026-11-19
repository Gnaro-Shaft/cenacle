// ADR-0044, point 10: the push key against a real `rrsync -wo -no-del
// -no-overwrite`, in a throwaway Debian with sshd, the key locked exactly as
// on the backup node. What is checked: a copy arrives, whole; and the same
// key cannot read a file back, delete one, overwrite one, leave the arrival,
// or run anything else. A node whose fingerprint is not the pinned one gets
// nothing. The image is built once from Debian's own packages.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CopieConfig } from "./config.ts";
import { findTool, isRealRsync, TOOLS } from "./export.ts";
import { rsyncArgs, runPush, SSH, sshCommand } from "./pousser.ts";
import { buildImage, IMAGE } from "./test-depot.ts";

const DIR = mkdtempSync(join(tmpdir(), "cenacle-rrsync-"));
const KEY = join(DIR, "pousser");
const NAME = `cenacle-rrsync-${process.pid}`;
const rsync = findTool(TOOLS.rsync, isRealRsync) ?? "rsync";
let config: CopieConfig;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });
const inside = (command: string) => docker("exec", NAME, "sh", "-c", command);

const SETUP = [
  "useradd -m depot",
  "install -d -o depot -m 0700 /srv/arrivee",
  "echo ancienne > /srv/arrivee/ancienne.age && chown depot /srv/arrivee/ancienne.age",
  "echo hors > /srv/hors.age",
  "install -d -o depot -m 0700 /home/depot/.ssh",
  `printf 'restrict,command="/usr/bin/rrsync -wo -no-del -no-overwrite /srv/arrivee" %s\\n' "$(cat /k/pousser.pub)" > /home/depot/.ssh/authorized_keys`,
  "chown depot /home/depot/.ssh/authorized_keys && chmod 600 /home/depot/.ssh/authorized_keys",
  "ssh-keygen -A >/dev/null",
  "exec /usr/sbin/sshd -D -e",
].join(" && ");

beforeAll(async () => {
  buildImage();
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", KEY]);
  chmodSync(KEY, 0o600);
  spawnSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  docker(
    "run",
    "-d",
    "--name",
    NAME,
    "-p",
    "127.0.0.1::22",
    "-v",
    `${DIR}:/k:ro`,
    IMAGE,
    "sh",
    "-c",
    SETUP,
  );
  const port = Number(docker("port", NAME, "22/tcp").trim().split("\n")[0]?.split(":").pop());
  const ready = () => inside("test -s /etc/ssh/ssh_host_ed25519_key.pub && echo y || echo n");
  for (let i = 0; i < 50 && ready().trim() !== "y"; i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 1000)); // sshd listening
  const hostKey = inside("cat /etc/ssh/ssh_host_ed25519_key.pub").trim().split(" ");
  writeFileSync(join(DIR, "known_hosts"), `[127.0.0.1]:${port} ${hostKey[0]} ${hostKey[1]}\n`);
  config = {
    recipient: "",
    knownHosts: join(DIR, "known_hosts"),
    address: "127.0.0.1",
    port,
    account: "depot",
  };
}, 600_000);

afterAll(() => {
  spawnSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  rmSync(DIR, { recursive: true, force: true });
});

let draws = 0;
function copy(text: string): string {
  const dir = join(DIR, `c${++draws}`);
  mkdirSync(dir);
  const file = join(dir, `cenacle-2026-11-18-${String(draws).padStart(16, "0")}.age`);
  writeFileSync(file, text);
  return file;
}
const nameOf = (file: string) => file.split("/").pop() ?? "";
/** rsync or ssh with the push key, by hand: what a thief of the key would try. */
const withKey = (tool: string, args: string[]) =>
  spawnSync(tool, args, {
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: "/usr/bin:/bin", HOME: DIR },
  });

describe("the push key, locked on rrsync -wo -no-del -no-overwrite", () => {
  it("pushes a copy, which arrives whole", async () => {
    const file = copy("une copie chiffrée, pour l'essai\n");
    expect(await runPush(rsync, rsyncArgs(config, KEY, file))).toBe(0);
    expect(inside(`cat /srv/arrivee/${nameOf(file)}`)).toBe("une copie chiffrée, pour l'essai\n");
  }, 60_000);

  it("never overwrites: the same name again leaves the first copy", async () => {
    const file = copy("la première\n");
    expect(await runPush(rsync, rsyncArgs(config, KEY, file))).toBe(0);
    writeFileSync(file, "une fausse, plus longue que la première\n");
    await runPush(rsync, rsyncArgs(config, KEY, file));
    expect(inside(`cat /srv/arrivee/${nameOf(file)}`)).toBe("la première\n");
  }, 60_000);

  it("never reads back", () => {
    const out = join(DIR, "relue");
    const run = withKey(rsync, ["-e", sshCommand(config, KEY), "127.0.0.1:ancienne.age", out]);
    expect(run.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it("never deletes, even asked to", () => {
    const empty = join(DIR, "vide");
    mkdirSync(empty);
    withKey(rsync, ["-r", "--delete", "-e", sshCommand(config, KEY), `${empty}/`, "127.0.0.1:"]);
    expect(inside("cat /srv/arrivee/ancienne.age")).toBe("ancienne\n");
  }, 60_000);

  it("never leaves the arrival", () => {
    const file = copy("évadée\n");
    withKey(rsync, ["-e", sshCommand(config, KEY), file, "127.0.0.1:../evadee.age"]);
    withKey(rsync, ["-e", sshCommand(config, KEY), file, "127.0.0.1:/srv/evadee.age"]);
    expect(inside("ls /srv")).not.toMatch(/evadee/);
    expect(inside("cat /srv/hors.age")).toBe("hors\n");
  }, 60_000);

  it("runs nothing else: no shell, no command", () => {
    const ssh = sshCommand(config, KEY).split(" ").slice(1);
    for (const command of ["cat /etc/passwd", "id", "sh -c id"]) {
      const run = withKey(SSH, [...ssh, "127.0.0.1", command]);
      expect(run.status, command).not.toBe(0);
      expect(run.stdout, command).not.toMatch(/root:|uid=/);
    }
  }, 60_000);

  it("a node that is not the pinned one gets nothing", async () => {
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(DIR, "autre")]);
    const other = execFileSync("cat", [join(DIR, "autre.pub")], { encoding: "utf8" }).split(" ");
    const forged = join(DIR, "known_hosts_faux");
    writeFileSync(forged, `[127.0.0.1]:${config.port} ${other[0]} ${other[1]}\n`);
    const file = copy("vers un faux nœud\n");
    const code = await runPush(rsync, rsyncArgs({ ...config, knownHosts: forged }, KEY, file));
    expect(code).not.toBe(0);
    expect(inside("ls /srv/arrivee")).not.toContain(nameOf(file));
  }, 60_000);
});
