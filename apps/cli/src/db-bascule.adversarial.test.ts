// npm run db:bascule keeps the passwords right whatever happens (ADR-0038):
// never a password the database does not know, never one it knows that no
// file keeps, never a value shown. The database side is a fake here; the real
// one is tested on a throwaway Postgres (packages/journal/src/bascule.integration.test.ts).
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BasculeError, type Cluster, NothingChanged } from "@cenacle/journal";
import { describe, expect, it, vi } from "vitest";
import { type BasculeDb, back, forward, readVar } from "./db-bascule.ts";

const CLUSTER: Cluster = {
  host: "127.0.0.1",
  port: "1",
  database: "cenacle",
  testDatabase: "cenacle_test",
};
const TODAY = "a".repeat(48);
const line = (name: string, value: string) => `# x\n${name}=${value}\n`;

function root(
  files: Record<string, string> = { ".env.owner": line("CENACLE_DB_OWNER_PASSWORD", TODAY) },
) {
  const dir = mkdtempSync(join(tmpdir(), "bascule-"));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, name), text, { mode: 0o600 });
  return dir;
}

function fakeDb(overrides: Partial<BasculeDb> = {}) {
  const db = {
    preview: vi.fn(async () => ({
      state: "before" as const,
      statements: [] as string[],
      scram: true,
    })),
    switch: vi.fn(async () => ({ transferred: 30, testDropped: true, switchRoleLeft: false })),
    back: vi.fn(async () => ({ switchRoleLeft: false })),
    ...overrides,
  };
  return db as typeof db & BasculeDb;
}

const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");
const valueIn = (dir: string, name: string, v: string) => readVar(dir, name, v);
const mode = (dir: string, name: string) => statSync(join(dir, name)).mode & 0o777;

describe("the switch, on the files", () => {
  it("puts the new owner's password in .env.owner, today's in .env.admin, keeps today's file aside", async () => {
    const dir = root();
    const db = fakeDb();
    const dump = vi.fn(() => "/somewhere/avant-bascule.dump");
    const done = await forward({ root: dir, cluster: CLUSTER, dump, db });
    expect(done).toMatchObject({ transferred: 30, dump: "/somewhere/avant-bascule.dump" });
    const next = valueIn(dir, ".env.owner", "CENACLE_DB_OWNER_PASSWORD");
    expect(next).toMatch(/^[0-9a-f]{48}$/);
    expect(next).not.toBe(TODAY);
    expect(valueIn(dir, ".env.admin", "CENACLE_DB_ADMIN_PASSWORD")).toBe(TODAY);
    expect(valueIn(dir, ".env.owner.avant-bascule", "CENACLE_DB_OWNER_PASSWORD")).toBe(TODAY);
    // The database was given exactly what the files hold.
    const [, passwords] = vi.mocked(db.switch).mock.calls[0] ?? [];
    expect(passwords).toMatchObject({ current: TODAY, next });
    expect(passwords?.temp).not.toBe(next);
    for (const name of [".env.owner", ".env.admin"]) expect(mode(dir, name)).toBe(0o600);
    expect(existsSync(join(dir, ".env.owner.nouveau"))).toBe(false);
    expect(existsSync(join(dir, ".env.admin.nouveau"))).toBe(false);
  });

  it("the dump comes first: if it fails, no file is written and the database is not touched", async () => {
    const dir = root();
    const db = fakeDb();
    const dump = () => {
      throw new Error("pg_dump failed");
    };
    await expect(forward({ root: dir, cluster: CLUSTER, dump, db })).rejects.toThrow("pg_dump");
    expect(db.switch).not.toHaveBeenCalled();
    expect(valueIn(dir, ".env.owner", "CENACLE_DB_OWNER_PASSWORD")).toBe(TODAY);
    expect(existsSync(join(dir, ".env.admin"))).toBe(false);
    expect(existsSync(join(dir, ".env.owner.nouveau"))).toBe(false);
  });

  it("a switch the database rolled back leaves today's files exactly as they were", async () => {
    const dir = root();
    const before = read(dir, ".env.owner");
    const db = fakeDb({
      switch: vi.fn(async () => {
        throw new NothingChanged("rolled back");
      }),
    });
    await expect(forward({ root: dir, cluster: CLUSTER, dump: () => "d", db })).rejects.toThrow(
      "rolled back",
    );
    expect(read(dir, ".env.owner")).toBe(before);
    for (const name of [
      ".env.admin",
      ".env.owner.nouveau",
      ".env.admin.nouveau",
      ".env.owner.avant-bascule",
    ]) {
      expect(existsSync(join(dir, name)), name).toBe(false);
    }
  });

  it.each([".env.admin", ".env.owner.avant-bascule", ".env.owner.nouveau", ".env.admin.nouveau"])(
    "refuses when %s is already there: nothing dumped, nothing switched, nothing overwritten",
    async (there) => {
      const dir = root({
        ".env.owner": line("CENACLE_DB_OWNER_PASSWORD", TODAY),
        [there]: "keep me\n",
      });
      const db = fakeDb();
      const dump = vi.fn(() => "d");
      await expect(forward({ root: dir, cluster: CLUSTER, dump, db })).rejects.toThrow(there);
      expect(dump).not.toHaveBeenCalled();
      expect(db.switch).not.toHaveBeenCalled();
      expect(read(dir, there)).toBe("keep me\n");
    },
  );

  it("refuses a switch already made, before any dump", async () => {
    const dir = root();
    const db = fakeDb({
      preview: vi.fn(async () => ({
        state: "done" as const,
        statements: [] as string[],
        scram: true,
      })),
    });
    const dump = vi.fn(() => "d");
    await expect(forward({ root: dir, cluster: CLUSTER, dump, db })).rejects.toThrow("déjà faite");
    expect(dump).not.toHaveBeenCalled();
  });

  it("never shows a password in what it throws", async () => {
    const dir = root();
    const db = fakeDb({
      switch: vi.fn(async () => {
        throw new NothingChanged("rolled back");
      }),
    });
    const error = await forward({ root: dir, cluster: CLUSTER, dump: () => "d", db }).catch(
      (e) => e,
    );
    expect(String(error)).not.toContain(TODAY);
  });
});

describe("what the review found (ADR-0038)", () => {
  it("an outcome the database could not confirm keeps every new password, and says where", async () => {
    const dir = root();
    const db = fakeDb({
      switch: vi.fn(async () => {
        throw new BasculeError("connection lost after COMMIT — the outcome is uncertain");
      }),
    });
    const error = await forward({ root: dir, cluster: CLUSTER, dump: () => "d", db }).catch(
      (e) => e,
    );
    expect(String(error)).toMatch(/\.env\.owner\.nouveau/);
    expect(error).not.toBeInstanceOf(NothingChanged);
    expect(valueIn(dir, ".env.owner.nouveau", "CENACLE_DB_OWNER_PASSWORD")).toMatch(
      /^[0-9a-f]{48}$/,
    );
    expect(valueIn(dir, ".env.admin.nouveau", "CENACLE_DB_ADMIN_PASSWORD")).toBe(TODAY);
    expect(valueIn(dir, ".env.owner", "CENACLE_DB_OWNER_PASSWORD")).toBe(TODAY);
  });

  it("a .env.owner that is a link (a worktree's) is refused before anything", async () => {
    const real = root();
    const dir = mkdtempSync(join(tmpdir(), "bascule-link-"));
    symlinkSync(join(real, ".env.owner"), join(dir, ".env.owner"));
    const db = fakeDb();
    const dump = vi.fn(() => "d");
    await expect(forward({ root: dir, cluster: CLUSTER, dump, db })).rejects.toThrow(/lien/);
    expect(dump).not.toHaveBeenCalled();
    expect(db.preview).not.toHaveBeenCalled();
  });

  it("a password a rename would clear (not SCRAM) is refused before the dump", async () => {
    const dir = root();
    const db = fakeDb({
      preview: vi.fn(async () => ({
        state: "before" as const,
        statements: [] as string[],
        scram: false,
      })),
    });
    const dump = vi.fn(() => "d");
    await expect(forward({ root: dir, cluster: CLUSTER, dump, db })).rejects.toThrow(/SCRAM/);
    expect(dump).not.toHaveBeenCalled();
    expect(existsSync(join(dir, ".env.owner.nouveau"))).toBe(false);
  });

  it("the way back, uncertain, keeps the admin's file and the new .env.owner aside", async () => {
    const dir = root({
      ".env.owner": line("CENACLE_DB_OWNER_PASSWORD", "b".repeat(48)),
      ".env.admin": line("CENACLE_DB_ADMIN_PASSWORD", TODAY),
    });
    const db = fakeDb({
      back: vi.fn(async () => {
        throw new BasculeError("uncertain");
      }),
    });
    await expect(back({ root: dir, cluster: CLUSTER, db })).rejects.toThrow(
      /\.env\.owner\.nouveau/,
    );
    expect(valueIn(dir, ".env.owner.nouveau", "CENACLE_DB_OWNER_PASSWORD")).toBe(TODAY);
    expect(valueIn(dir, ".env.admin", "CENACLE_DB_ADMIN_PASSWORD")).toBe(TODAY);
  });
});

describe("the way back, on the files", () => {
  const switched = () =>
    root({
      ".env.owner": line("CENACLE_DB_OWNER_PASSWORD", "b".repeat(48)),
      ".env.admin": line("CENACLE_DB_ADMIN_PASSWORD", TODAY),
      ".env.owner.avant-bascule": line("CENACLE_DB_OWNER_PASSWORD", TODAY),
    });

  it("the admin's password is the owner's again; .env.admin and the kept file go", async () => {
    const dir = switched();
    const db = fakeDb();
    await back({ root: dir, cluster: CLUSTER, db });
    expect(vi.mocked(db.back).mock.calls[0]?.[1]).toMatchObject({ admin: TODAY });
    expect(valueIn(dir, ".env.owner", "CENACLE_DB_OWNER_PASSWORD")).toBe(TODAY);
    expect(mode(dir, ".env.owner")).toBe(0o600);
    expect(existsSync(join(dir, ".env.admin"))).toBe(false);
    expect(existsSync(join(dir, ".env.owner.avant-bascule"))).toBe(false);
  });

  it("a way back the database refused leaves the switched files as they were", async () => {
    const dir = switched();
    const owner = read(dir, ".env.owner");
    const db = fakeDb({
      back: vi.fn(async () => {
        throw new NothingChanged("refused");
      }),
    });
    await expect(back({ root: dir, cluster: CLUSTER, db })).rejects.toThrow("refused");
    expect(read(dir, ".env.owner")).toBe(owner);
    expect(valueIn(dir, ".env.admin", "CENACLE_DB_ADMIN_PASSWORD")).toBe(TODAY);
    expect(existsSync(join(dir, ".env.owner.nouveau"))).toBe(false);
  });

  it("without .env.admin there is no way back to take", async () => {
    const db = fakeDb();
    await expect(back({ root: root(), cluster: CLUSTER, db })).rejects.toThrow(".env.admin manque");
    expect(db.back).not.toHaveBeenCalled();
  });
});

describe("reading a password from its file", () => {
  it.each([
    ["the file is missing", {}, ".env.owner manque"],
    [
      "the variable is missing",
      { ".env.owner": "# nothing\n" },
      "CENACLE_DB_OWNER_PASSWORD manque",
    ],
    [
      "the value is empty",
      { ".env.owner": "CENACLE_DB_OWNER_PASSWORD=\n" },
      "CENACLE_DB_OWNER_PASSWORD manque",
    ],
  ])("refuses when %s", (_what, files, message) => {
    expect(() => readVar(root(files), ".env.owner", "CENACLE_DB_OWNER_PASSWORD")).toThrow(message);
  });

  it("reads the right variable, not one whose name merely contains it", () => {
    const dir = root({
      ".env.owner": "XCENACLE_DB_OWNER_PASSWORD=wrong\nCENACLE_DB_OWNER_PASSWORD = right \n",
    });
    expect(readVar(dir, ".env.owner", "CENACLE_DB_OWNER_PASSWORD")).toBe("right");
  });
});
