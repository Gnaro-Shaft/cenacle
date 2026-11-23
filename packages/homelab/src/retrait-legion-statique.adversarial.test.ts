// ADR-0046, L1, point 7: the inventory contains no command that modifies. Read
// as text, without Docker, so it runs on the CI too. Quoted strings (labels,
// the awk programs) are set aside before looking for commands; the awk programs
// are then checked on their own for what awk could write with.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./test-homelab.ts";

const PATH = join(ROOT, "deploy", "homelab", "retrait-legion", "inventaire-legion");
const SCRIPT = readFileSync(PATH, "utf8");

/**
 * The script's code: comments gone, quoted text blanked — but what runs inside a
 * quoted `$(…)` kept, since it is code too. A small scanner, not regexes: an
 * apostrophe inside "…" (« d'uid ») would otherwise swallow real code.
 */
function code(script: string): string {
  let out = "";
  const stack: ("code" | "dq")[] = ["code"];
  const depth: number[] = [0];
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    const top = stack[stack.length - 1];
    if (top === "dq") {
      if (c === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (c === '"') {
        stack.pop();
        out += c;
        continue;
      }
      if (c === "$" && script[i + 1] === "(") {
        stack.push("code");
        depth.push(0);
        out += " (";
        i++;
        continue;
      }
      out += c === "\n" ? c : " ";
      continue;
    }
    if (c === "\\") {
      out += script.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;]/.test(script[i - 1] ?? ""))) {
      while (i < script.length && script[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      out += `'${script.slice(i + 1, end).replace(/[^\n]/g, " ")}'`;
      i = end;
      continue;
    }
    if (c === '"') {
      stack.push("dq");
      out += c;
      continue;
    }
    const d = depth.length - 1;
    if (c === "(") depth[d] = (depth[d] ?? 0) + 1;
    if (c === ")") {
      if (depth[d] === 0 && stack.length > 1) {
        stack.pop();
        depth.pop();
        out += c;
        continue;
      }
      depth[d] = (depth[d] ?? 0) - 1;
    }
    out += c;
  }
  return out;
}

const MODIFYING = [
  "rm",
  "rmdir",
  "mv",
  "cp",
  "ln",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "chgrp",
  "chattr",
  "install",
  "truncate",
  "tee",
  "dd",
  "shred",
  "sed",
  "perl",
  "python3",
  "userdel",
  "deluser",
  "usermod",
  "useradd",
  "passwd",
  "systemctl",
  "pct",
  "fstrim",
  "sudo",
  "su",
  "kill",
  "pkill",
  "crontab",
  "ssh",
  "scp",
  "rsync",
  "curl",
  "wget",
  "eval",
  "source",
  "exec",
  "trap",
  "export",
];

/** Modifying commands used as words of the code (not as parts of a path). */
const modifying = (body: string) =>
  MODIFYING.filter((w) => new RegExp(`(?:^|[\\s;&|(!])${w}(?=$|[\\s;&|)])`, "m").test(body));

/** Redirections of output anywhere but /dev/null or another descriptor. */
const writes = (body: string) =>
  (body.match(/\d?>>?\s*[^\s;)|]*/g) ?? []).filter(
    (r) => !/^\d?>(?:\/dev\/null|&[12])$/.test(r.replace(/\s+/g, "")),
  );

describe("the inventory, read as text (ADR-0046, point 7)", () => {
  const body = code(SCRIPT);

  it("calls no command that modifies", () => {
    expect(modifying(body)).toEqual([]);
  });

  it("redirects output nowhere but /dev/null", () => {
    expect(writes(body)).toEqual([]);
  });

  it("the checks catch what they look for: a removal, a write", () => {
    const tainted = code(
      `${SCRIPT}\nrm -rf "$R/var/lib/copie-bases"\n[ -e x ] && userdel -r ronde\necho x >> /tmp/f\n`,
    );
    expect(modifying(tainted)).toEqual(["rm", "userdel"]);
    expect(writes(tainted)).toEqual([">> /tmp/f"]);
    expect(modifying(code("ls /root/.ssh/authorized_keys"))).toEqual([]);
    expect(modifying(code(`echo "d'uid $(rm -f x)"`))).toEqual(["rm"]);
    expect(modifying(code(`k="$(du -s "$1" | tee /tmp/f)"`))).toEqual(["tee"]);
    expect(modifying(code("echo 'rm -rf /' # rm"))).toEqual([]);
  });

  it("asks tailscale for its serve status, and nothing else", () => {
    const calls = SCRIPT.match(/(?<!-v )"\$TAILSCALE"[^\n)]*/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toBe('"$TAILSCALE" serve status 2>/dev/null');
    expect(SCRIPT).toContain('timeout 20 "$TAILSCALE" serve status');
  });

  it("its awk programs neither write, nor pipe, nor run anything", () => {
    const programs = SCRIPT.match(/awk [^']*'[^']*'/g) ?? [];
    expect(programs.length).toBeGreaterThanOrEqual(3);
    for (const p of programs) {
      const prog = p.slice(p.indexOf("'"));
      expect(prog, prog).not.toMatch(/system\s*\(|getline|print[^;}\n]*[>|]|close\s*\(|fflush/);
    }
  });

  it("is an executable bash script under 400 lines", () => {
    expect(SCRIPT.startsWith("#!/bin/bash\n")).toBe(true);
    expect(SCRIPT.split("\n").length).toBeLessThanOrEqual(400);
    expect(statSync(PATH).mode & 0o111).toBe(0o111);
  });
});
