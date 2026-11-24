// ADR-0047, on the house's side, for real in a throwaway Debian: install.sh
// --bulletin-seul (the account and the bulletin, nothing else — no action
// script, no sudo rule, no needrestart guard; refused on a machine that has
// Cénacle's actions, or whose sudo grants the account anything, or whose
// account sits in another group), then the real bulletin, run as that
// account, reading the house's verdict in a folder that is root's, 0750,
// which the account may only pass through (an ACL, --x). What it must never
// do: read a verdict out of its form as SAIN (the house's ISO dates of
// 24/11/2026 among them), recite a motif's text, follow a link, read another
// folder's verdict, or list the folder. Skipped where Docker is absent (the CI).
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBulletin } from "./bulletin.ts";

const BASE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";
const IMAGE = "cenacle-test-bulletin-seul:1";
const DEPLOY = join(import.meta.dirname, "..", "..", "..", "deploy", "serveurs");
const FOLDER = "/var/lib/maison/mesure";

const docker = (() => {
  try {
    execFileSync("docker", ["image", "inspect", BASE], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
})();

const name = `cenacle-maison-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
/** bash -c in the container, as root unless `user` is given. */
const sh = (command: string, user?: string) => {
  const args = ["exec", ...(user ? ["-u", user] : []), name, "bash", "-c", command];
  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
  return { code: run.status ?? -1, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
};
const b64 = (s: string) => Buffer.from(s).toString("base64");
/** The house's verdict, placed as its writer leaves it: root's, 0644, by renaming. */
const place = (text: string, folder = FOLDER) =>
  sh(
    `install -d -m 0750 -o root -g root ${folder} && echo ${b64(text)} | base64 -d > ${folder}/.v && chmod 0644 ${folder}/.v && mv -f ${folder}/.v ${folder}/verdict`,
  );
const house = () => {
  const r = sh("/usr/local/bin/cenacle-bulletin", "cenacle");
  expect(r.code, r.out).toBe(0);
  return { text: r.out, backups: parseBulletin(r.out).backups };
};
const v = (...lines: string[]) => `${lines.join("\n")}\n`;
// As the house will write it once its format is fixed (ADR-0043's form).
const SAIN = v("verdict=SAIN", "instant=1794900000", "depuis=-", "fin=1");
const MALADE = v(
  "verdict=MALADE",
  "instant=1794900000",
  "depuis=1794300000",
  "motif=cout-hebdo-31.20-usd",
  "motif=echecs-4-sur-12",
  "fin=1",
);
let install: { code: number; out: string };

beforeAll(() => {
  if (!docker) return;
  const dockerfile = [
    "ARG BASE",
    "FROM $BASE",
    "RUN apt-get update && apt-get install -y --no-install-recommends sudo acl && rm -rf /var/lib/apt/lists/*",
  ].join("\n");
  execFileSync("docker", ["build", "-q", "--build-arg", `BASE=${BASE}`, "-t", IMAGE, "-"], {
    input: dockerfile,
    stdio: ["pipe", "ignore", "inherit"],
  });
  const run = ["run", "-d", "--network", "none", "--name", name, "-v", `${DEPLOY}:/d:ro`];
  execFileSync("docker", [...run, IMAGE, "sleep", "infinity"], { stdio: "ignore" });
  install = sh("/d/install.sh --bulletin-seul");
}, 600_000);
afterAll(() => {
  if (docker) spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
});

describe.skipIf(!docker)("install.sh --bulletin-seul", () => {
  it("the account and the bulletin, nothing else", () => {
    expect(install.code, install.out).toBe(0);
    expect(sh("id -Gn cenacle").out.trim()).toBe("cenacle");
    expect(sh("passwd -S cenacle").out.split(" ")[1]).toBe("L");
    const mode = sh("stat -c '%U:%G %a' /usr/local/bin/cenacle-bulletin").out.trim();
    expect(mode).toBe("root:root 755");
    for (const absent of [
      "/etc/sudoers.d/cenacle",
      "/usr/local/sbin/cenacle-services",
      "/usr/local/sbin/cenacle-redemarrer",
      "/usr/local/sbin/cenacle-maj-securite",
      "/etc/needrestart/conf.d/zz-cenacle.conf",
      "/etc/cenacle",
    ]) {
      expect(sh(`test -e ${absent}`).code, absent).not.toBe(0);
    }
  });

  it("sudo grants the account nothing", () => {
    for (const cmd of ["/bin/sh", `/usr/bin/cat ${FOLDER}/verdict`, "/usr/bin/setfacl"]) {
      expect(sh(`sudo -n -l -U cenacle -- ${cmd}`).code, cmd).not.toBe(0);
    }
    expect(sh("sudo -n true", "cenacle").code).not.toBe(0);
  });

  it("run again: the same, nothing more", () => {
    expect(sh("/d/install.sh --bulletin-seul").code).toBe(0);
    expect(sh("ls /etc/sudoers.d").out).not.toContain("cenacle");
  });

  it.each([
    ["an unknown argument", "/d/install.sh --tout", "", 2],
    ["another account than root", "/d/install.sh --bulletin-seul", "nobody", 1],
  ])("%s: refused", (_what, command, user, code) => {
    expect(sh(command, user || undefined).code).toBe(code);
  });

  it.each([
    [
      "Cénacle's actions already here",
      "touch /etc/sudoers.d/cenacle",
      "rm -f /etc/sudoers.d/cenacle",
      /actions are installed here/,
    ],
    [
      "a rule elsewhere that grants the account something",
      "echo 'cenacle ALL=(root) NOPASSWD: /bin/sh' > /etc/sudoers.d/autre && chmod 440 /etc/sudoers.d/autre",
      "rm -f /etc/sudoers.d/autre",
      /sudo grants the account cenacle something/,
    ],
    [
      "the account in another group",
      "usermod -aG adm cenacle",
      "gpasswd -d cenacle adm",
      /other groups/,
    ],
  ])("%s: refused, said", (_what, before, after, said) => {
    sh(before);
    const r = sh("/d/install.sh --bulletin-seul");
    sh(after);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(said);
  });
});

describe.skipIf(!docker)("the bulletin reads the house's verdict", () => {
  it("the folder closed, no ACL yet: illisible — never SAIN, never absent", () => {
    place(SAIN);
    sh(`setfacl -b ${FOLDER}`);
    expect(house().backups).toEqual([{ source: "maison", read: "illisible" }]);
  });

  it("the ACL lets it pass: SAIN read — the folder never listed, nobody else let in", () => {
    place(SAIN);
    expect(sh(`setfacl -m u:cenacle:--x ${FOLDER}`).code).toBe(0);
    expect(house().backups).toEqual([
      {
        source: "maison",
        read: "ok",
        verdict: "SAIN",
        at: 1_794_900_000_000,
        since: null,
        motifs: 0,
      },
    ]);
    expect(sh(`ls ${FOLDER}`, "cenacle").code).not.toBe(0);
    expect(sh(`cat ${FOLDER}/verdict`, "nobody").code).not.toBe(0);
  });

  it("MALADE: since when and how many motifs — never their text", () => {
    place(MALADE);
    const { text, backups } = house();
    for (const leak of ["cout-hebdo", "31.20", "echecs", "usd"]) expect(text).not.toContain(leak);
    expect(backups).toEqual([
      {
        source: "maison",
        read: "ok",
        verdict: "MALADE",
        at: 1_794_900_000_000,
        since: 1_794_300_000_000,
        motifs: 2,
      },
    ]);
  });

  it.each([
    [
      "the house's format of 24/11/2026 (ISO dates)",
      v(
        "verdict=SAIN",
        "instant=2026-11-24T17:03:14+00:00",
        "depuis=2026-11-24T17:03:14+00:00",
        "motif=aucun",
        "fin=1",
      ),
    ],
    ["no fin=1", v("verdict=SAIN", "instant=1794900000", "depuis=-")],
    [
      "a key it never writes",
      v("verdict=SAIN", "instant=1794900000", "depuis=-", "cout=12", "fin=1"),
    ],
    [
      "two verdicts",
      v("verdict=SAIN", "verdict=MALADE", "instant=1794900000", "depuis=-", "fin=1"),
    ],
    [
      "ill after its instant",
      v("verdict=MALADE", "instant=1794900000", "depuis=1794900001", "fin=1"),
    ],
    ["a word not a verdict", v("verdict=BON", "instant=1794900000", "depuis=-", "fin=1")],
  ])("%s: illisible, never a verdict", (_what, text) => {
    place(text);
    expect(house().backups).toEqual([{ source: "maison", read: "illisible" }]);
  });

  it("the verdict a link (to a SAIN elsewhere): illisible, never followed", () => {
    place(SAIN, "/var/lib/ailleurs");
    sh("chmod 755 /var/lib/ailleurs");
    place(MALADE);
    sh(`ln -sfn /var/lib/ailleurs/verdict ${FOLDER}/verdict`);
    expect(house().backups).toEqual([{ source: "maison", read: "illisible" }]);
  });

  it("no verdict in the folder, or no folder: nothing recited — the ronde says « sans verdict »", () => {
    sh(`rm -f ${FOLDER}/verdict`);
    expect(house().backups).toEqual([]);
    sh("rm -rf /var/lib/maison");
    expect(house().backups).toEqual([]);
  });

  it("a verdict beside the folder, not in it: never read", () => {
    place(SAIN, "/var/lib/maison");
    sh("chmod 755 /var/lib/maison");
    expect(house().backups).toEqual([]);
  });
});
