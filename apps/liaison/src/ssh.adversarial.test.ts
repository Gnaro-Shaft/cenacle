// The liaison's door (ADR-0048), against stand-ins for ssh: the demand reaches
// the standard input whole; the exit code and the output come back; a time
// limit or an answer too long is "cut off" (-1), never read; a program that
// cannot start is -2 — nothing left. The options are fixed: no configuration
// file, no agent, a pinned known_hosts, the command word last.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appeler, sshArgs } from "./ssh.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-liaison-ssh-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
let n = 0;
const stand = (body: string) => {
  const file = join(BASE, `stand-${++n}`);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};

describe("one call", () => {
  it("the input arrives whole, accents and line breaks included", async () => {
    const out = join(BASE, "recu");
    const input = JSON.stringify({ titre: "Été", description: "a\nb\tc" });
    const r = await appeler([], input, 1000, stand(`cat > "${out}"; echo ok`));
    expect(r).toEqual({ code: 0, out: "ok\n" });
    expect(readFileSync(out, "utf8")).toBe(input);
  });

  it("the exit code and the output come back, 1, 2 and 255 included", async () => {
    expect(await appeler([], "", 1000, stand("echo r; exit 1"))).toEqual({ code: 1, out: "r\n" });
    expect((await appeler([], "", 1000, stand("exit 2"))).code).toBe(2);
    expect((await appeler([], "", 1000, stand("exit 255"))).code).toBe(255);
  });

  it("cut off by the time limit: -1, and its output is never read", async () => {
    const r = await appeler([], "", 1000, stand("echo partiel; sleep 5"), 500);
    expect(r).toEqual({ code: -1, out: "" });
  }, 10_000);

  it("an answer longer than allowed: -1, never read", async () => {
    const r = await appeler([], "", 100, stand("head -c 5000 /dev/zero | tr '\\0' x"));
    expect(r).toEqual({ code: -1, out: "" });
  });

  it("a program that cannot start: -2", async () => {
    expect(await appeler([], "", 1000, join(BASE, "absent"))).toEqual({ code: -2, out: "" });
  });

  it("the environment carries no agent socket, whatever the process has", async () => {
    process.env.SSH_AUTH_SOCK = "/tmp/piege";
    try {
      const r = await appeler([], "", 1000, stand('echo "[$SSH_AUTH_SOCK]"'));
      expect(r.out).toBe("[]\n");
    } finally {
      delete process.env.SSH_AUTH_SOCK;
    }
  });
});

describe("the options", () => {
  const args = sshArgs(
    { hote: "vm.exemple", compte: "liaison", cle: "/k/cle", knownHosts: "/k/kh" },
    "deposer",
  );
  it("no configuration, no agent, the key alone, the host pinned", () => {
    expect(args.join(" ")).toContain("-F /dev/null");
    for (const o of [
      "IdentitiesOnly=yes",
      "IdentityAgent=none",
      "BatchMode=yes",
      "StrictHostKeyChecking=yes",
      "UserKnownHostsFile=/k/kh",
      "GlobalKnownHostsFile=/dev/null",
      "UpdateHostKeys=no",
    ]) {
      expect(args).toContain(o);
    }
  });
  it("the host after `--`, then the command word, last", () => {
    expect(args.slice(-4)).toEqual(["liaison", "--", "vm.exemple", "deposer"]);
  });
});
