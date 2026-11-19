// ADR-0045, H1b: the backup watch (veiller-les-sauvegardes) and the wait for
// the cluster's quorum (attendre-la-grappe), moved from Legion as they are.
// Legion's own trials, kept next to the scripts — pytest for the watch, the
// bash harness for the wait — run against the moved scripts; then the watch's
// verdict, from a fake cluster, is read by the real bulletin as Cénacle's
// veille expects (ADR-0043); and the wait never fails its unit. Skipped
// without Docker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBulletin } from "@cenacle/securite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, ROOT, startBox } from "./test-homelab.ts";

const HOMELAB = join(ROOT, "deploy", "homelab");
let box: Box;

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  box.sh(
    "install -m 755 /d/homelab/sauvegardes/veiller-les-sauvegardes.py /usr/local/bin/ && install -m 755 /d/homelab/grappe/attendre-la-grappe /usr/local/bin/",
  );
}, 600_000);
afterAll(() => box?.stop());

/** A fake pvesh: one job, one node online, one guest, one vzdump task `ago` seconds old. */
function fakeCluster(status: string, ago: number): string {
  const fake = [
    "#!/bin/bash",
    "now=$(date +%s)",
    'case "$2 $*" in',
    `  "/cluster/backup "*) echo '[{"id":"backup-001","enabled":"1","vmid":"100"}]' ;;`,
    `  "/cluster/resources "*node*) echo '[{"node":"noeud-a","status":"online"}]' ;;`,
    `  "/cluster/resources "*vm*) echo '[{"vmid":100,"node":"noeud-a"}]' ;;`,
    `  "/nodes/noeud-a/tasks "*) echo "[{\\"status\\":\\"${status}\\",\\"endtime\\":$((now - ${ago})),\\"type\\":\\"vzdump\\"}]" ;;`,
    "  *) exit 2 ;;",
    "esac",
  ].join("\n");
  box.sh(`printf '%s\\n' ${q(fake)} > /tmp/pvesh && chmod 755 /tmp/pvesh`);
  return "/tmp/pvesh";
}

const BULLETIN =
  "setpriv --reuid=65534 --regid=65534 --clear-groups bash /d/serveurs/cenacle-bulletin";
const recite = () =>
  parseBulletin(
    box.sh(
      `chmod 755 /var/lib/veiller-sauvegardes && chmod 644 /var/lib/veiller-sauvegardes/verdict && ${BULLETIN}`,
    ).out,
  ).backups;

describe.skipIf(!docker)("the backup watch and the quorum wait, moved into Cénacle", () => {
  it("passes Legion's trials of the watch unchanged (pytest)", () => {
    const t = box.sh(
      "cd / && python3 -m pytest -q -p no:cacheprovider /d/homelab/sauvegardes/test_veille_sauvegardes.py",
    );
    expect(t.out).toMatch(/18 passed/);
    expect(t.code, t.out.slice(-1500)).toBe(0);
  }, 300_000);

  it("passes Legion's harness of the wait unchanged, and never fails its unit", () => {
    const h = box.sh(
      "bash /d/homelab/grappe/eprouver-attente.sh /usr/local/bin/attendre-la-grappe",
    );
    expect(h.out).toMatch(/11 reussies, 0 echouees/);
    expect(h.code, h.out).toBe(0);
  }, 300_000);

  it("a healthy watch is read by the real bulletin: SAIN, no motif", () => {
    const pvesh = fakeCluster("OK", 3600);
    const run = box.sh(`SAUVEGARDES_PVESH=${pvesh} /usr/local/bin/veiller-les-sauvegardes.py`);
    expect(run.code, run.out + run.err).toBe(0);
    expect(recite()).toEqual([
      expect.objectContaining({ source: "veiller-sauvegardes", verdict: "SAIN", motifs: 0 }),
    ]);
  });

  it("a failed backup is MALADE for the bulletin, and its motif's text never leaves", () => {
    const pvesh = fakeCluster("backup failed: secret-motif", 3600);
    box.sh(`SAUVEGARDES_PVESH=${pvesh} /usr/local/bin/veiller-les-sauvegardes.py`);
    expect(box.sh(BULLETIN).out).not.toMatch(/secret-motif/);
    expect(recite()).toEqual([
      expect.objectContaining({ source: "veiller-sauvegardes", verdict: "MALADE", motifs: 1 }),
    ]);
  });
});

describe("the moved files carry no real name", () => {
  it("the unit calls the wait before judging, from /usr/local/bin, as in Legion", () => {
    const unit = readFileSync(
      join(HOMELAB, "sauvegardes", "veiller-les-sauvegardes.service"),
      "utf8",
    );
    expect(unit).toMatch(/^ExecStartPre=\/usr\/local\/bin\/attendre-la-grappe$/m);
    expect(unit).toMatch(/^ExecStart=\/usr\/local\/bin\/veiller-les-sauvegardes\.py$/m);
  });

  it("the trials of the watch name fictional nodes only", () => {
    const trials = readFileSync(join(HOMELAB, "sauvegardes", "test_veille_sauvegardes.py"), "utf8");
    expect(trials).toMatch(/"noeud-a"/);
    expect(trials).not.toMatch(/homeserv/i);
  });
});
