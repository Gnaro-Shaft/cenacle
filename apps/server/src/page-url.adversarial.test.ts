// The page's link (ADR-0019): written only I can read, read back only if it is
// exactly what the server writes, removed only if it is still ours — and the
// token never reaches the console (under launchd, the console is a log).
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { newToken } from "./guard.ts";
import {
  PageUrlError,
  pageUrl,
  pageUrlPath,
  readPageUrl,
  removePageUrl,
  writePageUrl,
} from "./page-url.ts";

const uid = userInfo().uid;
let home = "";
let path = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cenacle-page-"));
  path = pageUrlPath(home);
});

describe("the page's link", () => {
  it("written 0600 in a 0700 folder, atomically, and read back", () => {
    const url = pageUrl(newToken());
    writePageUrl(path, url);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(path))).toEqual(["page-url"]);
    expect(readPageUrl(path, uid)).toBe(url);
  });

  it("refuses a malformed token or link: nothing else is ever written", () => {
    expect(() => pageUrl("short")).toThrow();
    expect(() => pageUrl(`${newToken()}&next=https://evil.example`)).toThrow();
    expect(() => writePageUrl(path, "https://evil.example/#jeton=x")).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses to read: missing, readable by others, not mine, a symlink, too long, malformed", () => {
    expect(() => readPageUrl(path, uid)).toThrow(PageUrlError);
    const url = pageUrl(newToken());
    writePageUrl(path, url);
    chmodSync(path, 0o644);
    expect(() => readPageUrl(path, uid)).toThrow(/lisible par d'autres/);
    chmodSync(path, 0o600);
    expect(() => readPageUrl(path, uid + 1)).toThrow(/pas à toi/);
    const link = join(home, "link");
    symlinkSync(path, link);
    expect(() => readPageUrl(link, uid)).toThrow(/lien symbolique/);
    writeFileSync(path, `${url}\n`.repeat(10), { mode: 0o600 });
    expect(() => readPageUrl(path, uid)).toThrow(/trop long/);
    writeFileSync(path, "https://evil.example/#jeton=aaa\n", { mode: 0o600 });
    expect(() => readPageUrl(path, uid)).toThrow(/malformé/);
  });

  it("removed only if still ours: a newer server's link is left alone", () => {
    const mine = pageUrl(newToken());
    const newer = pageUrl(newToken());
    writePageUrl(path, newer);
    removePageUrl(path, mine);
    expect(readPageUrl(path, uid)).toBe(newer);
    removePageUrl(path, newer);
    expect(existsSync(path)).toBe(false);
    expect(() => removePageUrl(path, newer)).not.toThrow();
  });

  it("the server never prints the token or the link", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    const printed = [...main.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1] ?? "");
    expect(printed.length).toBeGreaterThan(0);
    for (const args of printed) {
      expect(args).not.toMatch(/token|link|jeton=/i);
      // Only the host and the port are ever interpolated.
      const interpolated = [...args.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
      for (const name of interpolated) expect(["HOST", "info.port"]).toContain(name);
    }
  });
});
