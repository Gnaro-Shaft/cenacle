// ADR-0044, point 10: the backup node's watcher, deploy/serveurs/veiller-copie-cenacle,
// run for real in a throwaway Debian set by install-copie.sh: what it keeps and
// what it refuses. A copy is kept under the server's arrival time; an empty one,
// one without age's header, a link, a folder, an odd name, more than the size
// limit, a transfer left unfinished are refused, MALADE. A store not set right
// is not examined. Never a name received in the verdict. The nights, the
// 7 days and the clock: veiller-nuits.adversarial.test.ts. Skipped where Docker
// is absent (the CI).
import { describe, expect, it } from "vitest";
import { docker, q, STATE, STORE, WATCHER } from "./test-depot.ts";
import { copy, D, H, HEADER, T, useWatcher } from "./test-veiller.ts";

describe.skipIf(!docker)("the watcher on the backup node: what it keeps, what it refuses", () => {
  const { sh, drop, run, ls } = useWatcher();

  it("before any copy: MALADE, said plainly, in the common format, readable by all", () => {
    const v = run(T);
    expect(v.code).toBe(1);
    expect(v.verdict).toBe("MALADE");
    expect(v.motifs).toEqual(["aucune copie gardée"]);
    expect(v.text.split("\n").slice(0, 3)).toEqual([
      "verdict=MALADE",
      `instant=${T}`,
      `depuis=${T}`,
    ]);
    expect(v.text.trim().split("\n").pop()).toBe("fin=1");
    expect(sh(`stat -c %a ${STATE}/verdict`).out.trim()).toBe("644");
    expect(sh(`cat ${STATE}/verdict`, "nobody").code).toBe(0);
  }, 60_000);

  it("a good copy: kept under its arrival, root's alone, whole; the arrival emptied", () => {
    drop(copy(1));
    const v = run(T);
    expect(v.code).toBe(0);
    expect(v.verdict).toBe("SAIN");
    expect(v.keys.get("derniere")).toBe(String(T));
    expect(v.keys.get("gardes")).toBe("1");
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`]);
    expect(sh(`stat -c '%U %a' ${STORE}/gardees/${T}-${copy(1)}`).out.trim()).toBe("root 600");
    expect(sh(`head -c 21 ${STORE}/gardees/${T}-${copy(1)}`).out).toBe("age-encryption.org/v1");
    expect(ls("arrivee")).toEqual([]);
    expect(ls("examen")).toEqual([]);
  }, 60_000);

  it.each([
    ["an odd name", "x.age", HEADER, "nom", "nom inattendu"],
    [
      "a name almost right",
      "cenacle-2026-11-18-0123456789ABCDEF.age",
      HEADER,
      "nom",
      "nom inattendu",
    ],
    ["a name with more after it", `${copy(9)}.gz`, HEADER, "nom", "nom inattendu"],
    ["an empty file", copy(9), "", "vide", "vide"],
    ["no age header", copy(9), "PGDMP\\x01\\x0e", "entete", "sans en-tête age"],
    [
      "age's header without its line end",
      copy(9),
      "age-encryption.org/v1",
      "entete",
      "sans en-tête age",
    ],
    [
      "an armored age file",
      copy(9),
      "-----BEGIN AGE ENCRYPTED FILE-----\\n",
      "entete",
      "sans en-tête age",
    ],
  ])(
    "%s: refused, quarantined under a name of ours, MALADE",
    (_what, name, body, reason, label) => {
      drop(copy(1));
      run(T - D);
      drop(name, body);
      const v = run(T);
      expect(v.verdict).toBe("MALADE");
      expect(v.motifs).toEqual([`refusées depuis la copie gardée la plus récente : 1 ${label}`]);
      expect(ls("refusees")).toEqual([`${T}-1-${reason}`]);
      expect(ls("gardees")).toEqual([`${T - D}-${copy(1)}`]);
      expect(v.keys.get("derniere")).toBe(String(T - D));
      expect(ls("arrivee")).toEqual([]);
    },
    60_000,
  );

  it("a link, even with a good name, is never followed: moved as a link, its target untouched", () => {
    const before = sh("sha256sum /etc/shadow; stat -c '%U %a' /etc/shadow").out;
    sh(
      `ln -s /etc/shadow ${STORE}/arrivee/${copy(1)} && chown -h cenacle-depot: ${STORE}/arrivee/${copy(1)}`,
    );
    const v = run(T);
    expect(v.motifs.join()).toMatch(/1 pas un fichier ordinaire/);
    expect(sh(`test -L ${STORE}/refusees/${T}-1-type && echo lien`).out.trim()).toBe("lien");
    expect(sh("sha256sum /etc/shadow; stat -c '%U %a' /etc/shadow").out).toBe(before);
    expect(ls("gardees")).toEqual([]);
  }, 60_000);

  it("a folder, with a link inside: refused whole, nothing in it followed", () => {
    sh(
      `mkdir ${STORE}/arrivee/${copy(1)} && ln -s /etc ${STORE}/arrivee/${copy(1)}/etc && chown -hR cenacle-depot: ${STORE}/arrivee/${copy(1)}`,
    );
    expect(run(T).motifs.join()).toMatch(/1 pas un fichier ordinaire/);
    expect(ls("refusees")).toEqual([`${T}-1-type`]);
    expect(sh("test -d /etc/ssh && echo ok").out.trim()).toBe("ok");
    // Its 7 days over, it goes, and /etc stays.
    run(T + 8 * D);
    expect(ls("refusees")).toEqual([]);
    expect(sh("test -f /etc/passwd && echo ok").out.trim()).toBe("ok");
  }, 60_000);

  it("a junk file in the same pass as a good copy: MALADE, not hidden by it", () => {
    drop(copy(1));
    drop("faux.age", "rien");
    expect(run(T).verdict).toBe("MALADE");
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`]);
  }, 60_000);

  it("a transfer in progress is left alone; left unfinished 6 hours, it is refused", () => {
    const now = Number(sh("date +%s").out.trim());
    const tmp = `.${copy(1)}.Xy12Ab`;
    drop(tmp, "age-encr");
    run(now + 60);
    expect(ls("arrivee")).toEqual([tmp]);
    // Its own date says "just now": only the ctime, which no client sets, counts.
    sh(`touch -d '2099-01-01' ${STORE}/arrivee/${tmp}`);
    const v = run(now + 7 * H);
    expect(ls("arrivee")).toEqual([]);
    expect(ls("refusees")).toEqual([`${now + 7 * H}-1-inacheve`]);
    expect(v.motifs.join()).toMatch(/1 transfert inachevé/);
  }, 60_000);

  it("never says a name it received, in the verdict or its output", () => {
    drop("cenacle-2026-11-18-hote.exemple.test.age");
    drop("motif=SAIN\\nverdict=SAIN", HEADER);
    sh(
      `mkdir ${STORE}/arrivee/secret-dossier && chown cenacle-depot: ${STORE}/arrivee/secret-dossier`,
    );
    const v = run(T);
    expect(`${v.text}${v.out}`).not.toMatch(/exemple|secret|hote/);
    expect(v.text.match(/^verdict=/gm)).toHaveLength(1);
    expect(v.verdict).toBe("MALADE");
  }, 60_000);

  it.each([
    ["a root folder others can read", `chmod 755 ${STORE}/gardees`, `chmod 700 ${STORE}/gardees`],
    [
      "a root folder the depot owns",
      `chown cenacle-depot ${STORE}/refusees`,
      `chown root ${STORE}/refusees`,
    ],
    [
      "a folder swapped for a link",
      `mv ${STORE}/examen /root/ex && ln -s /root/ex ${STORE}/examen`,
      `rm ${STORE}/examen && mv /root/ex ${STORE}/examen`,
    ],
    [
      "the arrival swapped for a link",
      `mv ${STORE}/arrivee /root/ar && ln -s /root/ar ${STORE}/arrivee`,
      `rm ${STORE}/arrivee && mv /root/ar ${STORE}/arrivee`,
    ],
  ])(
    "a store not set right (%s): nothing examined, MALADE, code 2",
    (_what, breakIt, mend) => {
      drop(copy(1));
      sh(breakIt);
      const v = run(T);
      sh(mend);
      expect(v.code).toBe(2);
      expect(v.motifs.join()).toMatch(/pas réglé/);
      expect(ls("arrivee")).toEqual([copy(1)]);
    },
    60_000,
  );

  it("another pass running: this one does nothing (75)", () => {
    drop(copy(1));
    const out = sh(
      `(flock ${STATE}/verrou sleep 3) & sleep 0.5; COPIE_CENACLE_MAINTENANT=${T} ${WATCHER}; echo "code $?"; wait`,
    ).out;
    expect(out).toMatch(/code 75/);
    expect(ls("arrivee")).toEqual([copy(1)]);
  }, 60_000);

  it("a pass cut short: what it left in the examination is judged by the next", () => {
    sh(
      `printf ${q(HEADER)} > ${STORE}/examen/${copy(1)} && chown cenacle-depot: ${STORE}/examen/${copy(1)}`,
    );
    drop(copy(1)); // the same name again: refused, never over the first
    const v = run(T);
    expect(ls("gardees")).toEqual([`${T}-${copy(1)}`]);
    expect(ls("refusees")).toEqual([`${T}-1-nom`]);
    expect(v.verdict).toBe("MALADE");
  }, 60_000);

  it("something unexpected among root's folders is said", () => {
    drop(copy(1));
    sh(`touch ${STORE}/gardees/intrus`);
    expect(run(T).motifs.join()).toMatch(/1 entrée\(s\) inattendue\(s\)/);
  }, 60_000);

  it("a descriptor kept open by the account, or a hard link, never reaches what is kept", () => {
    const at = `${STORE}/arrivee/${copy(1)}`;
    drop(copy(1));
    sh(`su -s /bin/bash cenacle-depot -c 'ln ${at} ${STORE}/arrivee/lien'`);
    const out = sh(
      `su -s /bin/bash cenacle-depot -c 'exec 3>>${at}; sleep 2; printf ALTERE >&3' & sleep 0.5; COPIE_CENACLE_MAINTENANT=${T} ${WATCHER} >/dev/null; wait; cat ${STORE}/gardees/${T}-${copy(1)}; stat -c ' liens=%h' ${STORE}/gardees/${T}-${copy(1)}`,
    ).out;
    expect(out).not.toMatch(/ALTERE/);
    expect(out).toMatch(/^age-encryption\.org\/v1/);
    expect(out).toMatch(/ liens=1\s*$/);
  }, 60_000);

  it("more than the size limit: refused, and no more than the limit is ever copied", () => {
    sh(
      `{ printf 'age-encryption.org/v1\\n'; head -c 5000 /dev/zero; } > ${STORE}/arrivee/${copy(1)}; chown cenacle-depot: ${STORE}/arrivee/*`,
    );
    const pass = sh(`COPIE_CENACLE_TAILLE_MAX=4096 COPIE_CENACLE_MAINTENANT=${T} ${WATCHER}`);
    expect(pass.out).toMatch(/1 plus de 1 Go/);
    expect(ls("refusees")).toEqual([`${T}-1-taille`]);
    expect(sh(`stat -c %s ${STORE}/refusees/${T}-1-taille`).out.trim()).toBe("4097");
  }, 60_000);
});
