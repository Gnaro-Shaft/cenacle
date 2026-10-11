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
import { keyIsPrivate, SSH } from "./ssh.ts";

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

  it("no other program launches ssh or reads serveurs.local.toml", () => {
    const outside = all.filter((p) => !p.startsWith(join(ROOT, "apps", "operateur")));
    for (const file of outside) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(ROOT, file)).not.toMatch(/["'`]\/usr\/bin\/ssh["'`]/);
      expect(text, relative(ROOT, file)).not.toMatch(/serveurs\.local\.toml["'`]\)/);
      expect(text, relative(ROOT, file)).not.toMatch(/import [^\n]*from "@cenacle\/operateur/);
    }
  });

  it("ssh's path is absolute, and its environment has no agent socket", () => {
    expect(SSH).toBe("/usr/bin/ssh");
    const text = readFileSync(join(import.meta.dirname, "ssh.ts"), "utf8");
    expect(text).not.toMatch(/SSH_AUTH_SOCK|\.\.\.process\.env/);
  });
});
