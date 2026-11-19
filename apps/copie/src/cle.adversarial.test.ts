// ADR-0044, point 7: my private key, typed at the terminal and never shown.
// Not a terminal: refused. The three lines age-keygen prints, pasted: the key
// line kept, the comments passed over. Ctrl-C: nothing. Whatever happens, the
// terminal leaves raw mode, and nothing said ever holds the key.
import { describe, expect, it } from "vitest";
import { type KeyInput, readHiddenKey } from "./cle.ts";

const KEY = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;

/** A terminal that types `chunks`, one after the other, once it is listened to. */
function terminal(chunks: string[], tty = true) {
  const modes: boolean[] = [];
  let listener: ((chunk: string) => void) | null = null;
  const input: KeyInput = {
    isTTY: tty,
    setRawMode: (raw: boolean) => modes.push(raw),
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => undefined,
    on: (_event, l) => {
      listener = l;
      queueMicrotask(() => {
        for (const c of chunks) listener?.(c);
      });
    },
    off: () => {
      listener = null;
    },
  };
  const said: string[] = [];
  return { input, modes, said, say: (t: string) => said.push(t) };
}

describe("readHiddenKey", () => {
  it("reads a typed key, Enter ending it; raw mode on, then off", async () => {
    const t = terminal([KEY.slice(0, 20), KEY.slice(20), "\r"]);
    await expect(readHiddenKey(t.input, t.say)).resolves.toBe(KEY);
    expect(t.modes).toEqual([true, false]);
    expect(t.said.join("")).not.toContain(KEY.slice(16));
  });

  it("takes the key line out of the three lines age-keygen prints, pasted at once", async () => {
    const pasted = `# created: 2026-11-19T08:23:14+01:00\n# public key: age1xyz\n${KEY}\n`;
    const t = terminal([pasted]);
    await expect(readHiddenKey(t.input, t.say)).resolves.toBe(KEY);
  });

  it("erases with backspace", async () => {
    const t = terminal([`${KEY}X`, "\u007f", "\r"]);
    await expect(readHiddenKey(t.input, t.say)).resolves.toBe(KEY);
  });

  it("Ctrl-C or Ctrl-D: abandoned, raw mode off", async () => {
    for (const stop of ["\u0003", "\u0004"]) {
      const t = terminal([KEY.slice(0, 30), stop, KEY.slice(30), "\r"]);
      await expect(readHiddenKey(t.input, t.say)).rejects.toThrow(/abandonné/);
      expect(t.modes).toEqual([true, false]);
    }
  });

  it("refuses a pipe: the key is never scripted", async () => {
    const t = terminal([`${KEY}\n`], false);
    await expect(readHiddenKey(t.input, t.say)).rejects.toThrow(/terminal/);
    expect(t.modes).toEqual([]);
  });

  it("a line too long is cut: what comes back is not a key", async () => {
    const t = terminal([`${KEY}${"Z".repeat(500)}`, "\r"]);
    const got = await readHiddenKey(t.input, t.say);
    expect(got.length).toBeLessThanOrEqual(200);
    expect(got).not.toBe(KEY);
  });
});
