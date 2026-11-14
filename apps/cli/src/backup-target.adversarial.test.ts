// npm run secrets:backup says where a backup cannot go, before the
// passphrase is asked — and never writes over another backup.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupTargetProblem } from "./backup-target.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "backup-target-"));

describe("where a backup may go", () => {
  it("a new name in an existing folder: fine", () => {
    expect(backupTargetProblem(join(fresh(), "cenacle-secrets-2026-11-14"))).toBeNull();
  });

  it("an existing backup is never written over: said, with what to do", () => {
    const out = join(fresh(), "cenacle-secrets");
    writeFileSync(out, "an older backup");
    expect(backupTargetProblem(out)).toMatch(/existe déjà.*autre nom/);
  });

  it("a link counts as something there, even one that points nowhere", () => {
    const dir = fresh();
    symlinkSync(join(dir, "nowhere"), join(dir, "cenacle-secrets"));
    expect(backupTargetProblem(join(dir, "cenacle-secrets"))).toMatch(/existe déjà/);
  });

  it("a folder that is not there: said; on /Volumes, the key may be unplugged", () => {
    expect(backupTargetProblem(join(fresh(), "missing", "cenacle-secrets"))).toMatch(
      /n'existe pas$/,
    );
    expect(backupTargetProblem("/Volumes/CENACLE-NO-SUCH-KEY/cenacle-secrets")).toMatch(
      /clé est-elle branchée/,
    );
  });

  it("a folder given as the name, or a file given as the folder: refused", () => {
    const dir = fresh();
    mkdirSync(join(dir, "sub"));
    expect(backupTargetProblem(join(dir, "sub"))).toMatch(/existe déjà/);
    writeFileSync(join(dir, "plain"), "x");
    expect(backupTargetProblem(join(dir, "plain", "cenacle-secrets"))).toMatch(
      /n'est pas un dossier/,
    );
  });

  it("an empty name: refused", () => {
    expect(backupTargetProblem("  ")).toMatch(/nom de fichier/);
  });
});
