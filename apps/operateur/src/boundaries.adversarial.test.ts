// The operator's boundaries (J6f): a key is used only when no one else can
// read it; ssh is launched by the operator alone, serveurs.local.toml read by
// it alone, in the whole code base; ssh's path is absolute, its environment
// carries no agent socket.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { keyIsPrivate, runSsh, SSH } from "./ssh.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-operateur-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("a key is used only when it is mine alone", () => {
  it.each([
    [0o600, true],
    [0o400, true],
    [0o640, false],
    [0o644, false],
    [0o604, false],
  ])("mode %s → %s", (mode, expected) => {
    const key = join(BASE, `cle-${mode.toString(8)}`);
    writeFileSync(key, "fictive key\n");
    chmodSync(key, mode);
    expect(keyIsPrivate(key)).toBe(expected);
  });

  it("a folder, a missing file, or another owner: refused", () => {
    const dir = join(BASE, "dossier");
    mkdirSync(dir, { mode: 0o700 });
    expect(keyIsPrivate(dir)).toBe(false);
    expect(keyIsPrivate(join(BASE, "absente"))).toBe(false);
    const key = join(BASE, "cle-autre");
    writeFileSync(key, "fictive key\n", { mode: 0o600 });
    expect(keyIsPrivate(key, statSync(key).uid + 1)).toBe(false);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", "dist"].includes(e.name) ? [] : sources(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

describe("ssh, and the servers' list, belong to the operator alone", () => {
  const all = [...sources(join(ROOT, "apps")), ...sources(join(ROOT, "packages"))];

  // The one exception (ADR-0039, moved by ADR-0040): the ronde reads the
  // machines' bulletins, launching ssh in this file alone, with read-only keys only.
  const BULLETINS = join(ROOT, "apps", "ronde", "src", "ssh.ts");
  const RONDE = sources(join(ROOT, "apps", "ronde"));
  // The second (ADR-0044): the nightly copy pushes one file through rrsync -wo,
  // naming ssh in this file alone, with its push key only.
  const PUSH = join(ROOT, "apps", "copie", "src", "pousser.ts");
  // The third (ADR-0048): the liaison hands my demands over to the house, and
  // reads where they are, launching ssh in this file alone, with its own key.
  const LIAISON_SSH = join(ROOT, "apps", "liaison", "src", "ssh.ts");
  const LIAISON = sources(join(ROOT, "apps", "liaison"));

  it("no other program launches ssh or reads serveurs.local.toml", () => {
    const outside = all.filter((p) => !p.startsWith(join(ROOT, "apps", "operateur")));
    for (const file of outside) {
      const text = readFileSync(file, "utf8");
      if (file !== BULLETINS && file !== PUSH && file !== LIAISON_SSH) {
        expect(text, relative(ROOT, file)).not.toMatch(/["'`]\/usr\/bin\/ssh["'`]/);
      }
      expect(text, relative(ROOT, file)).not.toMatch(/serveurs\.local\.toml["'`]\)/);
      expect(text, relative(ROOT, file)).not.toMatch(/import [^\n]*from "@cenacle\/operateur/);
    }
  });

  it("the ronde never touches an action key, nor the operator's list", () => {
    expect(RONDE.length).toBeGreaterThan(0);
    for (const file of RONDE) {
      const t = readFileSync(file, "utf8");
      expect(t, relative(ROOT, file)).not.toMatch(/serveurs\.local|parseServers|\.keys\b|\bcles\b/);
      expect(t, relative(ROOT, file)).not.toMatch(/cenacle-(services|redemarrer|maj)/);
    }
    const text = readFileSync(BULLETINS, "utf8");
    expect(text).not.toMatch(/SSH_AUTH_SOCK|\.\.\.process\.env/);
    // One child process, and only ssh: nothing else is ever launched from here.
    expect(text.match(/\bexecFile\(/g) ?? []).toHaveLength(1);
    expect(text).not.toMatch(/\b(spawn|exec|execSync|execFileSync|fork)\(/);
    // Its keys come from parc.local.toml alone, a file the operator never reads.
    const pass = readFileSync(join(ROOT, "apps", "ronde", "src", "pass.ts"), "utf8");
    expect(pass).toMatch(/parseParkMachines/);
    const operator = sources(join(ROOT, "apps", "operateur")).map((f) => readFileSync(f, "utf8"));
    for (const t of operator) expect(t).not.toMatch(/parc\.local\.toml|parseParkMachines/);
  });

  it("the copy pushes with its own key alone: no agent, no operator's or ronde's key", () => {
    const COPIE = sources(join(ROOT, "apps", "copie"));
    expect(COPIE).toContain(PUSH);
    for (const file of COPIE) {
      const t = readFileSync(file, "utf8");
      expect(t, relative(ROOT, file)).not.toMatch(
        /serveurs\.local|parc\.local|parseServers|parseParkMachines/,
      );
      expect(t, relative(ROOT, file)).not.toMatch(/SSH_AUTH_SOCK|\.\.\.process\.env/);
      if (file !== PUSH) expect(t, relative(ROOT, file)).not.toMatch(/\/usr\/bin\/ssh/);
    }
    const text = readFileSync(PUSH, "utf8");
    expect(text.match(/\bexecFile\(/g) ?? []).toHaveLength(1);
    expect(text).not.toMatch(/\b(spawn|exec|execSync|execFileSync|fork)\(/);
    expect(text).toMatch(/IdentityAgent=none/);
    expect(text).toMatch(/StrictHostKeyChecking=yes/);
  });

  it("the ronde's runner is the ronde's alone; the page's server reads no machine", () => {
    for (const file of all) {
      if (RONDE.includes(file)) continue;
      const text = readFileSync(file, "utf8");
      expect(text, relative(ROOT, file)).not.toMatch(/@cenacle\/ronde|apps\/ronde\/src/);
    }
    // ADR-0040: the page's server holds no read key, never opens the park's file, starts no process.
    for (const file of sources(join(ROOT, "apps", "server"))) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(ROOT, file)).not.toMatch(
        /parseParkMachines|PARK_FILE|parc\.local|child_process/,
      );
    }
    // In the ronde, ssh.ts alone may start a process.
    for (const file of RONDE.filter((f) => f !== BULLETINS)) {
      expect(readFileSync(file, "utf8"), relative(ROOT, file)).not.toMatch(/child_process/);
    }
  });

  it("the house's door is the liaison's alone, and the liaison holds no other key", () => {
    expect(LIAISON).toContain(LIAISON_SSH);
    // Only the liaison parses the door (host, account, key); the page and the
    // bot may read the folders, nothing else.
    for (const file of all) {
      if (LIAISON.includes(file) || file.includes(join("packages", "securite", "src"))) continue;
      const text = readFileSync(file, "utf8");
      expect(text, relative(ROOT, file)).not.toMatch(/parseLiaisonPorte|@cenacle\/liaison/);
    }
    for (const file of LIAISON) {
      const t = readFileSync(file, "utf8");
      expect(t, relative(ROOT, file)).not.toMatch(
        /serveurs\.local|parc\.local|parseServers|parseParkMachines|\.env\.page|\.env\.bot/,
      );
      expect(t, relative(ROOT, file)).not.toMatch(/cenacle-(services|redemarrer|maj|bulletin)/);
      expect(t, relative(ROOT, file)).not.toMatch(/SSH_AUTH_SOCK|\.\.\.process\.env/);
      expect(t, relative(ROOT, file)).not.toMatch(/\b(spawn|execSync|execFileSync|fork)\(/);
      // Processes: ssh in ssh.ts, ssh-keygen in cle.ts — nowhere else.
      const procs = t.match(/\bexecFile\(/g) ?? [];
      if (file === LIAISON_SSH || file.endsWith(join("src", "cle.ts"))) {
        expect(procs, relative(ROOT, file)).toHaveLength(1);
      } else expect(t, relative(ROOT, file)).not.toMatch(/child_process/);
    }
    const ssh = readFileSync(LIAISON_SSH, "utf8");
    expect(ssh).toMatch(/StrictHostKeyChecking=yes/);
    expect(ssh).toMatch(/IdentitiesOnly=yes/);
    expect(ssh).toMatch(/IdentityAgent=none/);
    expect(ssh).toMatch(/"-F",\s*"\/dev\/null"/);
    // The operator and the ronde never read the liaison's file.
    for (const file of [...sources(join(ROOT, "apps", "operateur")), ...RONDE]) {
      expect(readFileSync(file, "utf8"), relative(ROOT, file)).not.toMatch(
        /liaison\.local|Liaison/,
      );
    }
  });

  it("ssh's path is absolute, and its environment has no agent socket", () => {
    expect(SSH).toBe("/usr/bin/ssh");
    const text = readFileSync(join(import.meta.dirname, "ssh.ts"), "utf8");
    expect(text).not.toMatch(/SSH_AUTH_SOCK|\.\.\.process\.env/);
  });
});

describe("one call's answer: its exit code, or 'unknown' when cut off", () => {
  const stand = (name: string, body: string) => {
    const file = join(BASE, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  };

  it("the script's code comes back as it is, 255 included", async () => {
    expect(await runSsh([], 5_000, stand("code10", "exit 10"))).toBe(10);
    expect(await runSsh([], 5_000, stand("code255", "exit 255"))).toBe(255);
    expect(await runSsh([], 5_000, stand("code0", "exit 0"))).toBe(0);
  });

  it("cut off by the time limit: -1 (state unknown), never 255 (unreachable)", async () => {
    // A program that would answer 255 when stopped, as ssh does.
    const slow = stand("slow", "trap 'exit 255' TERM\nsleep 5 & wait");
    expect(await runSsh([], 300, slow)).toBe(-1);
  });
});
