// The pre-commit hook of this public repository (lot D4, 13/11): GitHub's
// noreply address only, no real name of mine from the unversioned list, and
// gitleaks — refused when missing. Run for real, in throwaway repositories,
// with fictional names and a stand-in gitleaks.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "../../../.githooks/pre-commit");
const NOREPLY = "12345+someone@users.noreply.github.com";

function repo(email: string, names: string | null, gitleaks = true) {
  const dir = mkdtempSync(join(tmpdir(), "cenacle-hook-"));
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir } });
  git("init", "-q");
  git("config", "user.email", email);
  git("config", "user.name", "Someone");
  writeFileSync(join(dir, "a.txt"), "old line srv-fictive-01\n");
  git("add", "a.txt");
  git("-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "first");
  if (names !== null) writeFileSync(join(dir, ".git", "cenacle-real-names"), names);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  if (gitleaks) {
    writeFileSync(join(bin, "gitleaks"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "gitleaks"), 0o755);
  }
  const run = () =>
    spawnSync("/bin/sh", [HOOK], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: `${bin}:/usr/bin:/bin` },
    });
  return { dir, git, run };
}

describe("the author's address", () => {
  it("GitHub's noreply address passes", () => {
    const r = repo(NOREPLY, "");
    expect(r.run().status).toBe(0);
  });

  it.each(["someone@gmail.example", "someone@users.noreply.github.com.example.test", ""])(
    "%j is refused",
    (email) => {
      const r = repo(email || "x", "");
      if (email === "") r.git("config", "user.email", "");
      const out = r.run();
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("noreply");
    },
  );
});

describe("the real names of the unversioned list", () => {
  const LIST = "# my machines\n\nsrv-fictive-01\ntailnet-fictif\n";

  it("an added line holding one, whatever its case: refused, and said where", () => {
    const r = repo(NOREPLY, LIST);
    writeFileSync(join(r.dir, "b.ts"), "// runs on SRV-FICTIVE-01 every night\n");
    r.git("add", "b.ts");
    const out = r.run();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("runs on SRV-FICTIVE-01");
  });

  it("a removed line holding one passes: removing a name is the fix", () => {
    const r = repo(NOREPLY, LIST);
    writeFileSync(join(r.dir, "a.txt"), "old line, name gone\n");
    r.git("add", "a.txt");
    expect(r.run().status).toBe(0);
  });

  it("whole words only: a longer word that starts like it passes", () => {
    const r = repo(NOREPLY, LIST);
    writeFileSync(join(r.dir, "b.ts"), "srv-fictive-010 and tailnet-fictifs\n");
    r.git("add", "b.ts");
    expect(r.run().status).toBe(0);
  });

  it("a name in a file name's content of any type, a comment or a string: refused", () => {
    const r = repo(NOREPLY, LIST);
    writeFileSync(join(r.dir, "c.md"), "Le nœud « tailnet-fictif » répond.\n");
    r.git("add", "c.md");
    expect(r.run().status).toBe(1);
  });

  it("no list, or a list of comments only: said, and the commit passes", () => {
    const none = repo(NOREPLY, null);
    writeFileSync(join(none.dir, "b.ts"), "srv-fictive-01\n");
    none.git("add", "b.ts");
    const out = none.run();
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("names not checked");
    const empty = repo(NOREPLY, "# nothing yet\n\n");
    writeFileSync(join(empty.dir, "b.ts"), "srv-fictive-01\n");
    empty.git("add", "b.ts");
    expect(empty.run().status).toBe(0);
  });
});

describe("gitleaks", () => {
  it("missing: the commit is refused, never let through", () => {
    const r = repo(NOREPLY, "", false);
    const out = r.run();
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("gitleaks is not installed");
  });
});
