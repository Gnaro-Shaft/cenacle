// npm run setup (lot D5, 13/11): a fresh checkout gets every file it needs,
// each family of secrets in its own file and nowhere else, every secret drawn,
// readable by me only, and nothing is ever overwritten.
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { familyOf, SECRET_FAMILIES } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { writeSetup } from "./setup.ts";

const ROOT = join(import.meta.dirname, "../../..");
const parse = (text: string) =>
  new Map(
    text.split("\n").flatMap((l) => {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
      return m === null ? [] : [[m[1] ?? "", m[2] ?? ""] as const];
    }),
  );

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "cenacle-setup-"));
  copyFileSync(join(ROOT, ".env.example"), join(dir, ".env.example"));
  return dir;
}

describe("a fresh checkout", () => {
  it("gets .env and the files of the families it needs, for me only", () => {
    const dir = fresh();
    const { written } = writeSetup(dir);
    expect(written.sort()).toEqual(
      [
        ".env",
        ".env.bot",
        ".env.executor",
        ".env.mail",
        ".env.obs",
        ".env.owner",
        ".env.page",
      ].sort(),
    );
    for (const name of written) {
      expect(statSync(join(dir, name)).mode & 0o777, name).toBe(0o600);
    }
  });

  it("each secret sits in its family's file, and .env holds none", () => {
    const dir = fresh();
    writeSetup(dir);
    const env = parse(readFileSync(join(dir, ".env"), "utf8"));
    for (const [name, value] of env) {
      if (value !== "") expect(familyOf(name), name).toBeNull();
    }
    for (const family of Object.values(SECRET_FAMILIES)) {
      if (!existsSync(join(dir, family.file))) continue;
      for (const name of parse(readFileSync(join(dir, family.file), "utf8")).keys()) {
        expect(family.vars as readonly string[], `${name} in ${family.file}`).toContain(name);
      }
    }
  });

  it("every secret is drawn, long enough, and never twice the same", () => {
    const a = fresh();
    const b = fresh();
    writeSetup(a);
    writeSetup(b);
    const read = (dir: string, file: string) => parse(readFileSync(join(dir, file), "utf8"));
    for (const [file, name, length] of [
      [".env.owner", "CENACLE_DB_OWNER_PASSWORD", 48],
      [".env.executor", "CENACLE_DB_EXECUTOR_PASSWORD", 48],
      [".env", "CENACLE_DB_APP_PASSWORD", 48],
      [".env.mail", "CENACLE_MAIL_KEY", 64],
      [".env.mail", "CENACLE_TEST_MAIL_PASSWORD", 32],
      [".env.obs", "GRAFANA_ADMIN_PASSWORD", 32],
    ] as const) {
      const value = read(a, file).get(name) ?? "";
      expect(value, name).toMatch(new RegExp(`^[0-9a-f]{${length}}$`));
      expect(read(b, file).get(name), name).not.toBe(value);
    }
    expect(read(a, ".env").get("CENACLE_ACCEPT_PUBLIC_KEY")).not.toBe("");
    expect(read(a, ".env").get("CENACLE_CONFIRM_PUBLIC_KEY")).not.toBe("");
    expect(read(a, ".env.page").get("CENACLE_ACCEPT_PRIVATE_KEY")).not.toBe("");
    expect(read(a, ".env.bot").get("CENACLE_CONFIRM_PRIVATE_KEY")).not.toBe("");
  });

  it("what a real mailbox or Telegram needs is left empty, for me", () => {
    const dir = fresh();
    writeSetup(dir);
    expect(parse(readFileSync(join(dir, ".env"), "utf8")).get("TELEGRAM_ALLOWED_CHAT_ID")).toBe("");
    expect(readFileSync(join(dir, ".env.mail"), "utf8")).not.toContain("CENACLE_MAIL_PASSWORD=");
    expect(existsSync(join(dir, ".env.telegram"))).toBe(false);
  });
});

describe("never over an existing file", () => {
  it.each([".env", ".env.owner", ".env.page"])(
    "%s already there: nothing written at all",
    (name) => {
      const dir = fresh();
      writeFileSync(join(dir, name), "MINE=1\n");
      expect(writeSetup(dir)).toEqual({ written: [], present: [name] });
      expect(readFileSync(join(dir, name), "utf8")).toBe("MINE=1\n");
      expect(existsSync(join(dir, name === ".env" ? ".env.owner" : ".env"))).toBe(false);
    },
  );
});
