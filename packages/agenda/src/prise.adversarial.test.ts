// The agenda's local socket (ADR-0042, point 7): only my account can open it
// (0600 in 0700); it never replaces a file that is not a socket; it serves
// one reading at a time; a request out of the schema, too long or silent is
// refused; no title crosses it, even one shaped like an hour; and the client
// refuses any answer out of the schema. The bot's side imports nothing of the
// reader (a test reads the code).
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgendaView } from "./lecture.ts";
import { createHoursService, listenHours } from "./prise.ts";
import { askHours, HoursError } from "./prise-client.ts";

const TRAP = "RDV M. Untel — 09:00";
const VIEW: AgendaView = {
  read: "ok",
  from: "2026-11-17",
  days: 2,
  accounts: [{ name: "pro", state: "ok" }],
  events: [
    {
      kind: "heure",
      title: TRAP,
      start: Date.parse("2026-11-18T08:00:00Z"),
      end: 0,
      account: "pro",
    },
    { kind: "journee", title: TRAP, first: "2026-11-18", last: "2026-11-18", account: "pro" },
  ],
  setAside: [],
};

let dir: string;
let path: string;
let close: (() => Promise<void>) | null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ag-"));
  path = join(dir, "s", "agenda.sock");
  close = null;
});
afterEach(async () => {
  await close?.();
  rmSync(dir, { recursive: true, force: true });
});

async function listen(read: (days: number) => Promise<AgendaView>, timeoutMs?: number) {
  const s = await listenHours(
    path,
    createHoursService(read),
    timeoutMs === undefined ? {} : { requestTimeoutMs: timeoutMs },
  );
  close = s.close;
}

/** Sends raw bytes, returns all the server said before closing. */
function raw(text: string | null): Promise<string> {
  return new Promise((resolve) => {
    let got = "";
    const c = createConnection(path, () => {
      if (text !== null) c.write(text);
    });
    c.setEncoding("utf8");
    c.on("data", (d: string) => {
      got += d;
    });
    c.on("close", () => resolve(got));
    c.on("error", () => resolve(got));
  });
}

/** Listens a bare server; its close also ends its connections. */
async function bare(at: string, onConn: (c: Socket) => void) {
  const conns = new Set<Socket>();
  const s = createServer((c) => {
    conns.add(c);
    c.on("error", () => {});
    onConn(c);
  });
  await new Promise<void>((r) => s.listen(at, r));
  return () =>
    new Promise<void>((r) => {
      s.close(() => r());
      for (const c of conns) c.destroy();
    });
}

describe("the socket", () => {
  it("is 0600 in a 0700 folder", async () => {
    await listen(async () => VIEW);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "s")).mode & 0o777).toBe(0o700);
  });

  it("never replaces a file that is not a socket, and does replace a stale socket", async () => {
    const plain = join(dir, "plain");
    writeFileSync(plain, "keep me");
    await expect(listenHours(plain, async () => ({ read: "absent" }))).rejects.toThrow();
    expect(readFileSync(plain, "utf8")).toBe("keep me");
    // A socket left by a killed server.
    const stale = await bare(join(dir, "stale.sock"), () => {});
    const s = await listenHours(join(dir, "stale.sock"), async () => ({ read: "absent" }));
    await s.close();
    await stale();
  });

  it("answers tomorrow with hours and counts, never a title", async () => {
    const asked: number[] = [];
    await listen(async (days) => {
      asked.push(days);
      return VIEW;
    });
    const wire = await raw('{"ask":"tomorrow"}\n');
    expect(wire).not.toContain("Untel");
    expect(wire).not.toContain("RDV");
    expect(JSON.parse(wire)).toEqual({
      read: "ok",
      days: [{ date: "2026-11-18", hours: ["09:00"], more: 0, wholeDays: 1, ongoing: 0 }],
      failures: [],
      setAside: 0,
    });
    expect(asked).toEqual([2]);
    const week = await askHours(path, "week");
    expect(week.read === "ok" && week.days.length).toBe(7);
    expect(asked).toEqual([2, 7]);
  });

  it("refuses a request out of the schema, too long, or not JSON", async () => {
    let reads = 0;
    await listen(async () => {
      reads++;
      return VIEW;
    });
    for (const bad of [
      '{"ask":"tomorrow","days":31}\n',
      '{"ask":"month"}\n',
      '{"ask":["week"]}\n',
      '{"question":"tomorrow"}\n',
      "tomorrow\n",
      `{"ask":"week","x":"${"a".repeat(300)}"}\n`,
      "a".repeat(400),
    ]) {
      expect(JSON.parse(await raw(bad))).toEqual({ error: "invalid" });
    }
    expect(reads).toBe(0);
  });

  it("drops a caller that says nothing", async () => {
    await listen(async () => VIEW, 100);
    expect(await raw(null)).toBe("");
    expect(await raw('{"ask":')).toBe("");
  });

  it("serves one reading at a time: the second asker is told busy", async () => {
    let release = () => {};
    let reads = 0;
    await listen(() => {
      reads++;
      return new Promise((r) => {
        release = () => r(VIEW);
      });
    });
    const first = askHours(path, "tomorrow");
    await new Promise((r) => setTimeout(r, 50));
    await expect(askHours(path, "week")).rejects.toMatchObject({ code: "busy" });
    release();
    expect((await first).read).toBe("ok");
    expect(reads).toBe(1);
    // Free again afterwards.
    const again = askHours(path, "week");
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect((await again).read).toBe("ok");
  });

  it("a reader's fault is one word, never its message", async () => {
    await listen(async () => {
      throw new Error(`secret detail ${TRAP}`);
    });
    const wire = await raw('{"ask":"week"}\n');
    expect(JSON.parse(wire)).toEqual({ error: "internal" });
    await expect(askHours(path, "week")).rejects.toMatchObject({ code: "internal" });
  });
});

describe("the client", () => {
  /** A fake server answering one fixed line. */
  async function fake(line: string) {
    const at = join(dir, "fake.sock");
    close = await bare(at, (c) => c.end(line));
    return at;
  }
  const day = (over: object = {}) => ({
    date: "2026-11-18",
    hours: ["09:00"],
    more: 0,
    wholeDays: 0,
    ongoing: 0,
    ...over,
  });
  const ok = (over: object = {}) => ({
    read: "ok",
    days: [day()],
    failures: [],
    setAside: 0,
    ...over,
  });

  it("accepts an answer of the schema", async () => {
    const at = await fake(`${JSON.stringify(ok())}\n`);
    expect(await askHours(at, "tomorrow")).toEqual(ok());
  });

  it("refuses an answer out of the schema: a title cannot slip in", async () => {
    for (const bad of [
      { ...ok(), title: TRAP },
      ok({ days: [day({ hours: ["09:00 RDV M. Untel"] })] }),
      ok({ days: [day({ hours: ["24:00"] })] }),
      ok({ days: [day({ title: TRAP })] }),
      ok({ days: [day({ date: "demain" })] }),
      ok({ days: Array.from({ length: 8 }, () => day()) }),
      ok({ failures: [{ account: "M. Untel", state: "refus" }] }),
      ok({ failures: [{ account: "pro", state: "le serveur dit: RDV" }] }),
      ok({ setAside: -1 }),
      { read: "config", why: TRAP },
      { error: TRAP },
    ]) {
      const at = await fake(`${JSON.stringify(bad)}\n`);
      await expect(askHours(at, "tomorrow"), JSON.stringify(bad)).rejects.toMatchObject({
        code: "broken",
      });
      await close?.();
      close = null;
    }
  });

  it("an answer without its end of line is broken", async () => {
    const at = await fake(JSON.stringify(ok()));
    await expect(askHours(at, "tomorrow")).rejects.toMatchObject({ code: "broken" });
  });

  it("no socket is said unreachable; a silent server times out", async () => {
    await expect(askHours(join(dir, "none.sock"), "week")).rejects.toMatchObject({
      code: "unreachable",
    });
    const at = join(dir, "mute.sock");
    close = await bare(at, () => {});
    const err = await askHours(at, "week", { timeoutMs: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HoursError);
    expect((err as HoursError).code).toBe("timeout");
  });
});

describe("a test reads the code", () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, f), "utf8");
  const imports = (f: string) => [...src(f).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

  it("the bot's side imports the protocol and node only, never the reader", () => {
    expect([...new Set(imports("prise-client.ts"))].sort()).toEqual([
      "./prise-protocole.ts",
      "node:net",
    ]);
    expect(imports("prise-protocole.ts")).toEqual(["node:path"]);
  });

  it("the socket makes its folder and socket file, and writes no content", () => {
    const text = src("prise.ts");
    expect(text).toContain(
      'import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";',
    );
    expect(text).not.toMatch(/writeFile|appendFile|createWriteStream|console\.|@cenacle\/journal/);
  });
});
