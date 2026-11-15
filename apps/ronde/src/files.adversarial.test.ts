// The ronde's files (ADR-0040, R2): written whole — a reader sees the old
// file or the new one, never half of one — and mine alone to read (600),
// even over a draft an earlier crash left readable by others.
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readOrNull, writeWhole } from "./files.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-ronde-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

describe("written whole", () => {
  it("the new text replaces the old, mode 600, no draft left behind", () => {
    const path = join(BASE, "verdict");
    writeFileSync(path, "old\n", { mode: 0o644 });
    writeWhole(path, "etat=SAIN\nfin=1\n");
    expect(readFileSync(path, "utf8")).toBe("etat=SAIN\nfin=1\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(BASE).filter((f) => f.endsWith(".en-cours"))).toEqual([]);
  });

  it("a draft left readable by an earlier crash: written, then made mine alone", () => {
    const path = join(BASE, "bulletins.json");
    writeFileSync(`${path}.en-cours`, "half", { mode: 0o644 });
    chmodSync(`${path}.en-cours`, 0o644);
    writeWhole(path, "{}\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("{}\n");
  });

  it("a folder that is not there yet is made, mine alone", () => {
    const path = join(BASE, "sous", "verdict");
    writeWhole(path, "x\n");
    expect(statSync(join(BASE, "sous")).mode & 0o777).toBe(0o700);
  });
});

describe("read back", () => {
  it("absent: null; present: its text; a folder: thrown, never taken for empty", () => {
    expect(readOrNull(join(BASE, "absent"))).toBeNull();
    writeWhole(join(BASE, "present"), "x\n");
    expect(readOrNull(join(BASE, "present"))).toBe("x\n");
    expect(() => readOrNull(BASE)).toThrow();
  });
});
