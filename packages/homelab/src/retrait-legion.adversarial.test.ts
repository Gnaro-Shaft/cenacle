// ADR-0046, L1: the read-only inventory of what Legion left on a machine, run
// against fake roots in the throwaway Debian (point 7 of the ADR): every trace
// found, a clean machine says « rien ne reste » and a single trace never does,
// unreadable is never absent, no byte of a key or a data file leaves, no link is
// followed, the pieces kept on purpose are never listed, nothing is written.
// Skipped without Docker; the static checks of the script live apart and run on
// the CI (retrait-legion-statique.adversarial.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLEAN, DIRTY, KEPT, SECRETS, TRACES } from "./retrait-legion-racines.ts";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

const SCRIPT = "/d/homelab/retrait-legion/inventaire-legion";
const NOBODY = "setpriv --reuid=65534 --regid=65534 --clear-groups";
let box: Box;
let roots = 0;

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  const fakes: Record<string, string> = {
    "ts-legion":
      "echo 'https://hote.exemple.ts.net (tailnet only)'; echo '|-- / proxy http://127.0.0.1:8787'",
    "ts-vide": "echo 'No serve config'",
    "ts-autre": "echo '|-- / proxy http://127.0.0.1:87870'",
    "ts-ipv6": "echo '|-- / proxy http://[::1]:8787'",
    "ts-casse": "exit 1",
  };
  for (const [name, body] of Object.entries(fakes)) {
    box.sh(
      `printf '#!/bin/bash\\n%s\\n' ${q(body)} > /usr/local/bin/${name} && chmod 755 /usr/local/bin/${name}`,
    );
  }
}, 600_000);
afterAll(() => box?.stop());

/** A fresh fake root built by `setup` (bash, as root, from inside it); its path. */
function root(...setup: string[]): string {
  const r = `/tmp/racine-${++roots}`;
  const made = box.sh(`set -e; mkdir -p ${r}; cd ${r}\n${setup.join("\n")}`);
  expect(made.code, made.err).toBe(0);
  return r;
}

function inventory(r: string, opts: { tailscale?: string | undefined; as?: string } = {}) {
  const env = `INVENTAIRE_RACINE=${r} INVENTAIRE_TAILSCALE=${opts.tailscale ?? "ts-vide"}`;
  return box.sh(`${opts.as ?? ""} env ${env} bash ${SCRIPT}`);
}

/** The labels of the lines that say `word`. */
const said = (out: string, word: string) =>
  out
    .split("\n")
    .filter((l) => l.startsWith(`${word.padEnd(9)} `))
    .map((l) => l.slice(10));
const saysOf = (out: string, word: string, label: string) =>
  said(out, word).some((l) => l.startsWith(label));

describe.skipIf(!docker)(
  "the inventory of Legion's traces (ADR-0046, point 3)",
  { timeout: 120_000 },
  () => {
    it("finds every trace of a machine Legion lived on, and says what remains", () => {
      const run = inventory(root(DIRTY), { tailscale: "ts-legion" });
      expect(run.code, run.out + run.err).toBe(1);
      for (const t of TRACES)
        expect(saysOf(run.out, "PRÉSENTE", t.label), `${t.label}\n${run.out}`).toBe(true);
      const present = said(run.out, "PRÉSENTE");
      expect(present).toContain("authorized_keys de root : 1 ligne(s) de Legion");
      expect(run.out).toMatch(/garde : zz-cenacle\.conf est là/);
      expect(run.out).toMatch(new RegExp(`^reste ${present.length} trace\\(s\\) :$`, "m"));
      expect(run.out).not.toMatch(/rien ne reste/);
      expect(said(run.out, "ILLISIBLE")).toEqual([]);
      expect(run.err).toBe("");
    });

    it("a clean machine — Cénacle's keys, the kept pieces — ends with « rien ne reste »", () => {
      const run = inventory(root(CLEAN));
      expect(run.code, run.out + run.err).toBe(0);
      expect(run.out.trim().split("\n").at(-1)).toBe("rien ne reste");
      expect(said(run.out, "PRÉSENTE")).toEqual([]);
      expect(said(run.out, "ILLISIBLE")).toEqual([]);
      for (const kept of KEPT) expect(run.out + run.err).not.toContain(kept);
    });

    it("a single trace left never says « rien ne reste », whichever it is", () => {
      for (const t of TRACES) {
        const run = inventory(root(CLEAN, t.make), { tailscale: t.tailscale });
        expect(run.code, `${t.label}\n${run.out}`).toBe(1);
        expect(run.out).not.toMatch(/rien ne reste/);
        expect(saysOf(run.out, "PRÉSENTE", t.label), `${t.label}\n${run.out}`).toBe(true);
      }
    });

    it("each of Legion's marks is counted alone; a line without one, or commented out, is not", () => {
      for (const mark of [
        "ronde-legion",
        "legion-bulletin",
        "veilleur-legion",
        "copie-bases",
        "/.legion/",
      ]) {
        const run = inventory(
          root(CLEAN, `echo 'ssh-ed25519 AAAA x${mark}x' >> home/cenacle/.ssh/authorized_keys`),
        );
        expect(said(run.out, "PRÉSENTE"), mark).toEqual([
          "authorized_keys du compte d'uid 1001 : 1 ligne(s) de Legion",
        ]);
      }
      const run = inventory(
        root(
          CLEAN,
          "printf '%s\\n' 'ssh-ed25519 AAAAautre cenacle-bulletin legion' '# ssh-ed25519 AAAAvieille ronde-legion' '  #command=\"/usr/local/bin/legion-bulletin\" ssh-ed25519 AAAA' >> root/.ssh/authorized_keys",
        ),
      );
      expect(run.code, run.out).toBe(0);
      expect(said(run.out, "absente")).toContain("authorized_keys de root");
    });

    it("reads the cluster's keys by their own path; root's link to them is not unreadable", () => {
      const r = root(
        CLEAN,
        "rm root/.ssh/authorized_keys && ln -s /etc/pve/priv/authorized_keys root/.ssh/authorized_keys",
        "mkdir -p etc/pve/priv && echo 'ssh-ed25519 AAAA veilleur-legion' > etc/pve/priv/authorized_keys",
      );
      const run = inventory(r);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toMatch(
        /^- {9}authorized_keys de root : un lien vers \/etc\/pve\/priv\/authorized_keys, compté là$/m,
      );
      expect(said(run.out, "PRÉSENTE")).toEqual([
        "authorized_keys de la grappe (/etc/pve/priv) : 1 ligne(s) de Legion",
      ]);
      expect(said(run.out, "ILLISIBLE")).toEqual([]);
    });

    it("root's link to the cluster's keys, with /etc/pve empty (pve-cluster stopped), is ILLISIBLE", () => {
      const r = root(
        CLEAN,
        "rm root/.ssh/authorized_keys && ln -s /etc/pve/priv/authorized_keys root/.ssh/authorized_keys",
        "mkdir -p etc/pve",
      );
      const run = inventory(r);
      expect(run.code, run.out).toBe(2);
      expect(run.out).not.toMatch(/rien ne reste|compté là/);
      expect(said(run.out, "ILLISIBLE")).toEqual([
        "authorized_keys de root (un lien vers /etc/pve/priv/authorized_keys, introuvable : /etc/pve est-il monté ?)",
      ]);
    });

    it("a mark counts whatever its case; ronde's lines count wherever its home is", () => {
      const upper = inventory(
        root(CLEAN, "echo 'ssh-ed25519 AAAA Ronde-LEGION' >> root/.ssh/authorized_keys"),
      );
      expect(said(upper.out, "PRÉSENTE")).toEqual([
        "authorized_keys de root : 1 ligne(s) de Legion",
      ]);
      const elsewhere = inventory(
        root(
          CLEAN,
          "echo 'ronde:x:998:998::/var/lib/ronde:/bin/sh' >> etc/passwd",
          "mkdir -p var/lib/ronde/.ssh && echo 'ssh-ed25519 AAAA ronde-legion' > var/lib/ronde/.ssh/authorized_keys",
        ),
      );
      expect(said(elsewhere.out, "PRÉSENTE")).toEqual([
        "authorized_keys du compte d'uid 998 : 1 ligne(s) de Legion",
        "le compte ronde",
      ]);
    });

    it("follows no link: a linked key file is unreadable, a linked trace is present and unsized", () => {
      const r = root(
        CLEAN,
        "mkdir -p /tmp/ailleurs/.ssh && echo 'ssh-ed25519 AAAA ronde-legion' > /tmp/ailleurs/.ssh/authorized_keys",
        "dd if=/dev/zero of=/tmp/ailleurs/gros bs=1M count=8 status=none",
        "rm -r home/humain && ln -s /tmp/ailleurs home/humain",
        "mkdir -p var/backups/legion-bases && ln -s /tmp/ailleurs/gros var/backups/legion-bases/lien",
        "ln -s /tmp/ailleurs var/lib/copie-bases",
        "ln -s /tmp/ailleurs/.ssh/authorized_keys root/.ssh/authorized_keys2",
        "rm root/.ssh/authorized_keys && ln -s /tmp/ailleurs/.ssh/authorized_keys root/.ssh/authorized_keys",
      );
      const run = inventory(r);
      expect(run.code, run.out).toBe(1);
      expect(said(run.out, "ILLISIBLE")).toEqual(
        expect.arrayContaining([
          "authorized_keys de root (un lien, non suivi)",
          "authorized_keys2 de root (un lien, non suivi)",
          "authorized_keys du compte d'uid 1000",
          "authorized_keys2 du compte d'uid 1000",
        ]),
      );
      expect(said(run.out, "PRÉSENTE")).toContain(
        "/var/lib/copie-bases (ne part qu'après S3) (un lien, non suivi)",
      );
      const size = run.out.match(/legion-bases \(les copies de ses bases\) — (\d+) Kio$/m);
      expect(size, run.out).not.toBeNull();
      expect(Number(size?.[1])).toBeLessThan(100);
      expect(run.out).not.toMatch(/ligne\(s\) de Legion/);
    });

    it("run without root, what it cannot read is ILLISIBLE, never absent, and the end says so", () => {
      const dirty = inventory(root(DIRTY, "chmod 700 root home/humain/.ssh"), { as: NOBODY });
      expect(dirty.out).toMatch(/^attention : lancé sans être root/m);
      for (const t of TRACES.filter((t) => t.hidden)) {
        expect(saysOf(dirty.out, "ILLISIBLE", t.label), `${t.label}\n${dirty.out}`).toBe(true);
      }
      expect(
        said(dirty.out, "absente").filter((l) => l.includes("/root/") || l.includes("uid 1000")),
      ).toEqual([]);
      expect(dirty.out).toMatch(/^et \d+ lecture\(s\) impossible\(s\)$/m);

      const clean = inventory(root(CLEAN, "chmod 700 root", "chmod 600 etc/passwd"), {
        as: NOBODY,
      });
      expect(clean.code, clean.out).toBe(2);
      expect(clean.out).toMatch(
        /rien de présent, mais \d+ lecture\(s\) impossible\(s\) : relancer en root/,
      );
      expect(clean.out).not.toMatch(/rien ne reste/);
      expect(said(clean.out, "ILLISIBLE")).toEqual(
        expect.arrayContaining([
          "les comptes humains (/etc/passwd)",
          "le compte ronde (/etc/passwd)",
        ]),
      );
    });

    it("a key file it may not read, in a readable home, is ILLISIBLE", () => {
      const r = root(
        CLEAN,
        "echo 'ssh-ed25519 AAAA ronde-legion' > home/humain/.ssh/authorized_keys",
        "chmod 600 home/humain/.ssh/authorized_keys",
      );
      const run = inventory(r, { as: NOBODY });
      expect(run.code, run.out).toBe(2);
      expect(said(run.out, "ILLISIBLE")).toContain("authorized_keys du compte d'uid 1000");
    });

    it("the proxy: Legion's port is present, another port or none is absent, a failure is unreadable", () => {
      const clean = root(CLEAN);
      expect(said(inventory(clean, { tailscale: "ts-legion" }).out, "PRÉSENTE")).toEqual([
        "tailscale serve vers 127.0.0.1:8787",
      ]);
      expect(inventory(clean, { tailscale: "ts-autre" }).code).toBe(0);
      expect(said(inventory(clean, { tailscale: "ts-ipv6" }).out, "PRÉSENTE")).toEqual([
        "tailscale serve vers 127.0.0.1:8787",
      ]);
      expect(inventory(clean, { tailscale: "ts-vide" }).code).toBe(0);
      expect(said(inventory(clean, { tailscale: "absent-du-tout" }).out, "absente")).toContain(
        "tailscale serve (pas de tailscale)",
      );
      const broken = inventory(clean, { tailscale: "ts-casse" });
      expect(broken.code).toBe(2);
      expect(said(broken.out, "ILLISIBLE")).toEqual(["tailscale serve status"]);
    });

    it("legion.conf without zz-cenacle.conf beside it: the guard says it stays", () => {
      const run = inventory(
        root(
          CLEAN,
          "touch etc/needrestart/conf.d/legion.conf",
          "rm etc/needrestart/conf.d/zz-cenacle.conf",
        ),
      );
      expect(run.code).toBe(1);
      expect(run.out).toMatch(/garde : zz-cenacle\.conf ABSENT, legion\.conf reste/);
    });

    it("no byte of a key, a key line, a data file or an account name leaves the machine", () => {
      for (const as of ["", NOBODY]) {
        const run = inventory(root(DIRTY), { tailscale: "ts-legion", as });
        for (const secret of SECRETS)
          expect(run.out + run.err, `${secret} (${as || "root"})`).not.toContain(secret);
      }
    });

    it("writes nothing: no modifying syscall, and the root unchanged", () => {
      const r = root(DIRTY);
      const snap = `find ${r} -printf '%p %m %s %T@ %l\\n' | sort | sha256sum`;
      const before = box.sh(snap).out;
      const calls =
        "open,openat,creat,mkdir,mkdirat,rmdir,unlink,unlinkat,rename,renameat,renameat2,link,linkat,symlink,symlinkat," +
        "chmod,fchmod,fchmodat,chown,fchown,lchown,fchownat,truncate,ftruncate,utimensat";
      const run = box.sh(
        `strace -f -qq -o /tmp/trace.txt -e trace=${calls} env INVENTAIRE_RACINE=${r} INVENTAIRE_TAILSCALE=ts-legion bash ${SCRIPT} >/dev/null`,
      );
      expect(run.code).toBe(1);
      const trace = box.sh("cat /tmp/trace.txt").out.split("\n");
      const opens = trace.filter((l) => /\bopenat?\(/.test(l));
      expect(opens.length).toBeGreaterThan(10);
      const writes = opens.filter(
        (l) => /O_(WRONLY|RDWR|CREAT|TRUNC|APPEND)/.test(l) && !/"\/dev\/(null|tty)"/.test(l),
      );
      expect(writes).toEqual([]);
      const others = trace.filter((l) => l.trim() && !/\bopenat?\(|\+\+\+|---|resumed>/.test(l));
      expect(others).toEqual([]);
      expect(box.sh(snap).out).toBe(before);
    });
  },
);
