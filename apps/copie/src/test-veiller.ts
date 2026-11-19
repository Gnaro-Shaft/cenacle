// Shared by the watcher's tests (ADR-0044, point 5): a node set by
// install-copie.sh, emptied before each test, and what the push key would
// leave in the arrival. The clock is the test's: a pass runs at `now`.
import { afterAll, beforeAll, beforeEach } from "vitest";
import { buildImage, type Node, q, STATE, STORE, startNode, WATCHER } from "./test-depot.ts";

export const T = 1_800_000_000;
export const H = 3600;
export const D = 86_400;
export const HEADER =
  "age-encryption.org/v1\\n-> X25519 c2VsLWRlLWwnZXNzYWk\\n--- dGVzdA\\n\\x01\\x02";
export const copy = (n: number) => `cenacle-2026-11-18-${n.toString(16).padStart(16, "0")}.age`;

export interface Verdict {
  code: number;
  out: string;
  text: string;
  keys: Map<string, string>;
  motifs: string[];
  verdict: string | undefined;
}

export interface Watcher {
  sh: Node["sh"];
  /** A file of the depot account's in the arrival. */
  drop(name: string, printf?: string): void;
  /** One pass at `now`, and the verdict it wrote. */
  run(now: number): Verdict;
  /** A folder of the store, as `ls -A` lists it. */
  ls(dir: string): string[];
}

/** Registers the node's hooks: call it once, at the top of a test file. */
export function useWatcher(): Watcher {
  let node: Node | undefined;
  const sh: Node["sh"] = (command, user) => {
    if (!node) throw new Error("no node");
    return node.sh(command, user);
  };
  beforeAll(() => {
    buildImage();
    node = startNode();
    const install = node.sh("/d/install-copie.sh");
    if (install.code !== 0) throw new Error(install.out);
  }, 600_000);
  afterAll(() => node?.stop());
  beforeEach(() => {
    sh(
      `for d in arrivee examen gardees refusees; do find ${STORE}/$d -mindepth 1 -delete; done; rm -f ${STATE}/verdict`,
    );
  });
  return {
    sh,
    drop(name, printf = HEADER) {
      const at = `${STORE}/arrivee/${name}`;
      sh(`printf -- ${q(printf)} > ${q(at)} && chown cenacle-depot: ${q(at)}`);
    },
    run(now) {
      const pass = sh(`COPIE_CENACLE_MAINTENANT=${now} ${WATCHER}`);
      const text = sh(`cat ${STATE}/verdict`).out;
      const keys = new Map<string, string>();
      const motifs: string[] = [];
      for (const line of text.trim().split("\n")) {
        const [key, ...rest] = line.split("=");
        if (key === "motif") motifs.push(rest.join("="));
        else keys.set(key ?? "", rest.join("="));
      }
      return { code: pass.code, out: pass.out, text, keys, motifs, verdict: keys.get("verdict") };
    },
    ls(dir) {
      return sh(`ls -A ${STORE}/${dir}`)
        .out.split("\n")
        .filter((l) => l !== "");
    },
  };
}
