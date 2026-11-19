// ADR-0044, point 10: the backup node's watcher, deploy/serveurs/veiller-copie-cenacle,
// over the nights. The age runs from the server's arrival, never the file's
// date; a second copy within 12 hours is kept and said, so a false copy pushed
// with a stolen key evicts no true one; 7 days by arrival, the most recent kept
// whatever its age; more than 36 hours without a copy, a refusal not followed
// by a copy, a clock behind the arrivals are MALADE. Skipped where Docker is
// absent (the CI).
import { describe, expect, it } from "vitest";
import { docker, q, STORE } from "./test-depot.ts";
import { copy, D, H, HEADER, T, useWatcher } from "./test-veiller.ts";

describe.skipIf(!docker)("the watcher on the backup node, over the nights", () => {
  const { sh, drop, run, ls } = useWatcher();

  it("the file's own date is never read: the age runs from the arrival", () => {
    drop(copy(1));
    sh(`touch -d '2001-01-01' ${STORE}/arrivee/${copy(1)}`);
    expect(run(T).keys.get("derniere")).toBe(String(T));
    drop(copy(2));
    sh(`touch -d '2099-01-01' ${STORE}/arrivee/${copy(2)}`);
    const A = T + 13 * H;
    expect(run(A).keys.get("derniere")).toBe(String(A));
    expect(run(A + 35 * H).verdict).toBe("SAIN");
    const late = run(A + 37 * H);
    expect(late.verdict).toBe("MALADE");
    expect(late.motifs.join()).toMatch(/il y a 37 h \(plus de 36 h\)/);
  }, 60_000);

  it("a second copy within 12 hours is kept, and said; the next copy alone in its night clears it", () => {
    drop(copy(1));
    expect(run(T).verdict).toBe("SAIN");
    drop(copy(2));
    const twice = run(T + 11 * H);
    expect(twice.verdict).toBe("MALADE");
    expect(twice.motifs).toEqual([
      "2 copies gardées arrivées en moins de 12 h : une seule est attendue par nuit",
    ]);
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`, `${T + 11 * H}-${copy(2)}`]);
    expect(ls("refusees")).toEqual([]);
    expect(run(T + 12 * H).verdict).toBe("MALADE"); // still: nothing new since
    drop(copy(3));
    expect(run(T + 22 * H).verdict).toBe("MALADE"); // 11 h after the second: no single night yet
    drop(copy(4));
    const next = run(T + 35 * H);
    expect(next.verdict).toBe("SAIN");
    expect(next.keys.get("gardes")).toBe("4"); // each kept its 7 days
  }, 60_000);

  it("two copies in one pass: both kept — MALADE until the next copy", () => {
    drop(copy(1));
    drop(copy(2));
    const v = run(T);
    expect(v.verdict).toBe("MALADE");
    expect(v.motifs.join()).toMatch(/^2 copies gardées arrivées en moins de 12 h/);
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`, `${T}-${copy(2)}`]);
    expect(run(T + H).verdict).toBe("MALADE");
    drop(copy(3));
    expect(run(T + D).verdict).toBe("SAIN");
  }, 60_000);

  it("a stolen key pushing a false copy before each true one evicts none, and is said each night", () => {
    for (let night = 0; night < 9; night++) {
      drop(copy(100 + night)); // the false one, first
      run(T + night * D);
      drop(copy(night)); // the Mac's, two hours later
      const v = run(T + night * D + 2 * H);
      expect(v.verdict).toBe("MALADE");
      expect(v.motifs.join()).toMatch(/^2 copies gardées arrivées en moins de 12 h/);
    }
    const kept = ls("gardees");
    for (let night = 1; night < 9; night++) {
      expect(kept).toContain(`${T + night * D + 2 * H}-${copy(night)}`); // the true ones, 7 days
    }
    expect(kept).not.toContain(`${T + 2 * H}-${copy(0)}`); // 8 days: gone, as every copy
    expect(ls("refusees")).toEqual([]);
    // The key no longer used: the next copy, alone in its night, clears it.
    drop(copy(9));
    expect(run(T + 9 * D + 2 * H).verdict).toBe("SAIN");
  }, 120_000);

  it("7 days by arrival; the Mac stopped, the most recent copy stays, said after 36 h", () => {
    for (let day = 0; day <= 8; day++) {
      drop(copy(day + 1));
      run(T + day * D);
    }
    const kept = ls("gardees");
    expect(kept).not.toContain(`${T}-${copy(1)}`); // 8 days: gone
    expect(kept).toContain(`${T + D}-${copy(2)}`); // 7 days exactly: still there
    expect(kept).toHaveLength(8);
    const later = run(T + 30 * D);
    expect(ls("gardees")).toEqual([`${T + 8 * D}-${copy(9)}`]);
    expect(later.keys.get("gardes")).toBe("1");
    expect(later.verdict).toBe("MALADE");
    expect(later.motifs.join()).toMatch(/il y a 528 h/);
  }, 120_000);

  it("the quarantine goes after 7 days too", () => {
    drop("faux.age", "rien");
    run(T);
    expect(ls("refusees")).toHaveLength(1);
    const v = run(T + 7 * D + 1);
    expect(ls("refusees")).toEqual([]);
    expect(v.keys.get("refusees")).toBe("0");
    expect(v.motifs).toEqual(["aucune copie gardée"]);
  }, 60_000);

  it("`depuis` holds while ill, is cleared by a healthy pass, set again after", () => {
    expect(run(T).keys.get("depuis")).toBe(String(T));
    expect(run(T + H).keys.get("depuis")).toBe(String(T));
    drop(copy(1));
    expect(run(T + 2 * H).keys.get("depuis")).toBe("-");
    expect(run(T + 40 * H).keys.get("depuis")).toBe(String(T + 40 * H));
    // A clock gone back never makes `depuis` later than the instant.
    expect(run(T + 39 * H).keys.get("depuis")).toBe(String(T + 39 * H));
  }, 60_000);

  it("a flood: all kept, nothing evicted, and the verdict says how many in one night", () => {
    sh(
      `for i in $(seq 1 120); do printf ${q(HEADER)} > ${STORE}/arrivee/cenacle-2026-11-18-$(printf %016x $i).age; done; chown cenacle-depot: ${STORE}/arrivee/*`,
    );
    const v = run(T);
    expect(ls("gardees")).toHaveLength(120);
    expect(v.keys.get("gardes")).toBe("120");
    expect(v.keys.get("refusees")).toBe("0");
    expect(v.motifs.join()).toMatch(/^120 copies gardées arrivées en moins de 12 h/);
  }, 120_000);

  it("the motif counts only the refusals since the most recent copy kept", () => {
    drop("ancien.age", "rien");
    run(T);
    drop(copy(1));
    run(T + 13 * H);
    drop("nouveau.age", "rien");
    const v = run(T + 2 * D);
    expect(v.keys.get("refusees")).toBe("2");
    expect(v.motifs).toEqual(["refusées depuis la copie gardée la plus récente : 1 nom inattendu"]);
  }, 60_000);

  it("a clock behind an arrival already filed: said, and the copy stays", () => {
    drop(copy(1));
    run(T);
    const v = run(T - H);
    expect(v.verdict).toBe("MALADE");
    expect(v.motifs.join()).toMatch(/horloge du serveur retarde/);
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`]);
    // An 8-day-old copy next to one filed "in the future": the old one is not erased.
    sh(`printf x > ${STORE}/gardees/${T - 8 * D}-${copy(2)}`);
    run(T - H);
    expect(ls("gardees")).toContain(`${T - 8 * D}-${copy(2)}`);
  }, 60_000);
});
