// ADR-0045, H1a: copie-dumps, moved from Legion as it is. Legion's own
// harness (139 trials, kept unchanged next to the script) runs against the
// moved script; then what the move adds: no source or destination by
// default — absent or out of shape, nothing is copied, no verdict is written,
// the variable is named and its value never said — both units read them from
// /etc/default/copie-dumps, and the verdict written is read by the real
// bulletin as Cénacle's veille expects (ADR-0043). Skipped without Docker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBulletin } from "@cenacle/securite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, ROOT, startBox } from "./test-homelab.ts";

const DIR = join(ROOT, "deploy", "homelab", "copie-dumps");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
let box: Box;

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  // The script beside its tirage, as installed: /usr/local/bin.
  box.sh(
    "install -m 755 /d/homelab/copie-dumps/copier-les-dumps /usr/local/bin/ && install -m 644 /d/homelab/copie-dumps/copie-dumps-tirage /usr/local/bin/",
  );
}, 600_000);
afterAll(() => box?.stop());

/** One run with these settings, in a fresh bench; the verdict, if any. */
function run(env: Record<string, string | null>) {
  const bench = box.sh("mktemp -d").out.trim();
  box.sh(`mkdir -p ${bench}/source ${bench}/dest ${bench}/etat`);
  const base: Record<string, string> = {
    COPIE_SOURCE: `${bench}/source/`,
    COPIE_DEST: `${bench}/dest`,
    COPIE_ETAT: `${bench}/etat`,
    COPIE_MARGE: "0",
    COPIE_PERIPH: "/dev/sda",
  };
  const set = Object.entries({ ...base, ...env })
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${q(v as string)}`)
    .join(" ");
  const unset = Object.entries(env)
    .filter(([, v]) => v === null)
    .map(([k]) => `-u ${k}`)
    .join(" ");
  const r = box.sh(`env ${unset} ${set} /usr/local/bin/copier-les-dumps`);
  const verdict = box.sh(`cat ${bench}/etat/verdict 2>/dev/null`).out;
  return { ...r, bench, verdict };
}

describe.skipIf(!docker)("copie-dumps, moved into Cénacle", () => {
  it("passes Legion's harness unchanged: 139 trials, none failed", () => {
    const h = box.sh(
      "bash /d/homelab/copie-dumps/eprouver-copie.sh /usr/local/bin/copier-les-dumps",
    );
    expect(h.out).toMatch(/139 réussies, 0 échouées/);
    expect(h.out).not.toMatch(/n'a PAS été éprouvée/);
    expect(h.code, h.out.slice(-2000)).toBe(0);
  }, 600_000);

  it.each(["COPIE_SOURCE", "COPIE_DEST"])(
    "%s absent: nothing copied, no verdict, the name said",
    (name) => {
      const r = run({ [name]: null });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(new RegExp(`${name} manque ou est hors de forme`));
      expect(r.verdict).toBe("");
    },
  );

  it.each([
    ["COPIE_SOURCE", "root@secret-hote:/var/lib/vz/dump"],
    ["COPIE_SOURCE", "root@secret hote:/var/lib/vz/dump/"],
    ["COPIE_SOURCE", "secret-hote:/var/lib/vz/dump/"],
    ["COPIE_SOURCE", "root@secret-hote:/var/../etc/"],
    ["COPIE_SOURCE", "root@secret-hote:/x/;id/"],
    ["COPIE_SOURCE", ""],
    ["COPIE_DEST", "secret-relatif"],
    ["COPIE_DEST", "/"],
    ["COPIE_DEST", "/var/backups/../../etc/secret"],
    ["COPIE_DEST", "/var/backups/secret dump"],
    ["COPIE_DEST", "//"],
    ["COPIE_DEST", "/."],
    ["COPIE_DEST", "/var/./secret"],
    ["COPIE_DEST", "/var/backups/"],
    ["COPIE_SOURCE", "root@secret-hote:/"],
    ["COPIE_SOURCE", "root@secret-hote://"],
    ["COPIE_SOURCE", "/secret/.hidden/../"],
  ])("%s out of shape (%s): refused, its value never said", (name, value) => {
    const r = run({ [name]: value });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`${name} manque ou est hors de forme`));
    expect(`${r.out}${r.err}`).not.toMatch(/secret/);
    expect(r.verdict).toBe("");
  });

  it("a remote source of the right shape is taken: rsync is tried, the failure is a verdict", () => {
    const r = run({ COPIE_SOURCE: "root@192.0.2.10:/var/lib/vz/dump/" });
    expect(r.err).not.toMatch(/hors de forme/);
    expect(r.verdict).toMatch(/^verdict=MALADE$/m);
    expect(r.verdict).toMatch(/^motif=rsync a échoué/m);
  });

  it("its verdict is read by the real bulletin, as the veille expects", () => {
    const bench = box.sh("mktemp -d").out.trim();
    box.sh(
      `mkdir -p ${bench}/source && head -c 4096 /dev/urandom | zstd -q -o ${bench}/source/vzdump-lxc-100-2026_11_19-03_00_00.tar.zst`,
    );
    const r = box.sh(
      `COPIE_SOURCE=${bench}/source/ COPIE_DEST=${bench}/dest COPIE_MARGE=0 COPIE_PERIPH=/dev/sda /usr/local/bin/copier-les-dumps`,
    );
    expect(r.code, r.out + r.err).toBe(0);
    const recited = box.sh(
      "chmod 755 /var/lib/copie-dumps && chmod 644 /var/lib/copie-dumps/verdict && setpriv --reuid=65534 --regid=65534 --clear-groups bash /d/serveurs/cenacle-bulletin",
    );
    const backups = parseBulletin(recited.out).backups;
    expect(backups).toEqual([
      expect.objectContaining({ source: "copie-dumps", read: "ok", verdict: "SAIN", motifs: 0 }),
    ]);
  });
});

describe("the moved files carry no source, destination or real name of their own", () => {
  it("the script has no default source or destination", () => {
    const script = read("copier-les-dumps");
    expect(script).toMatch(/^SOURCE="\$\{COPIE_SOURCE:-\}"$/m);
    expect(script).toMatch(/^DEST="\$\{COPIE_DEST:-\}"$/m);
  });

  it("both units read /etc/default/copie-dumps, and set no source themselves", () => {
    for (const unit of ["copie-dumps.service", "copie-dumps-retour.service"]) {
      const text = read(unit);
      expect(text, unit).toMatch(/^EnvironmentFile=-\/etc\/default\/copie-dumps$/m);
      expect(text, unit).not.toMatch(/^Environment=COPIE_/m);
    }
  });

  it("the example is fictional: a documentation address, an example name", () => {
    const example = read("copie-dumps.exemple.conf");
    expect(example).toMatch(/^COPIE_SOURCE=root@192\.0\.2\.\d+:\/var\/lib\/vz\/dump\/$/m);
    expect(example).toMatch(/^COPIE_DEST=\/var\/backups\/noeud-exemple-dump$/m);
  });
});
