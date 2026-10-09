// No program prints the message of an error it does not know: a mail
// server's or a database's message may quote a host, an account or an
// address. Errors are printed through errorText (packages/core), which keeps
// the messages the project writes itself and names every other error.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");

function sources(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const top of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, top), { recursive: true, encoding: "utf8" })) {
      if (!/(^|\/)src\//.test(entry) || entry.includes("node_modules")) continue;
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const path = join(ROOT, top, entry);
      found.push({ path: relative(ROOT, path), text: readFileSync(path, "utf8") });
    }
  }
  return found;
}

/** The index of the quote closing the string or template opened at `at`. */
function skipQuoted(text: string, at: number): number {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === quote) return i;
    else if (quote === "`" && text.startsWith("${", i)) {
      // An interpolation: braces counted, its own strings skipped.
      let depth = 0;
      for (i += 1; i < text.length; i += 1) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") i = skipQuoted(text, i);
        else if (c === "{") depth += 1;
        else if (c === "}" && --depth === 0) break;
      }
    }
  }
  return text.length;
}

/** The text between the parenthesis at `open` and the one closing it. */
function enclosed(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length && i < open + 4000; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = skipQuoted(text, i);
    else if (c === "(") depth += 1;
    else if (c === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** The arguments of every console call; null when they cannot be read. */
function consoleCalls(text: string): (string | null)[] {
  return [...text.matchAll(/console\.\w+\s*\(/g)].map((m) =>
    enclosed(text, (m.index ?? 0) + m[0].length - 1),
  );
}

/** Each catch block: the name it binds and its body. */
function catchBlocks(text: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  for (const m of text.matchAll(/catch\s*\(\s*(\w+)\s*\)\s*\{/g)) {
    let depth = 0;
    const start = (m.index ?? 0) + m[0].length - 1;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}" && --depth === 0) {
        blocks.push({ name: m[1] ?? "", body: text.slice(start, i + 1) });
        break;
      }
    }
  }
  return blocks;
}

/** What is wrong in a source: each console call printing a message or a raw caught error. */
function violations(text: string): string[] {
  const found: string[] = [];
  for (const args of consoleCalls(text)) {
    if (args === null) found.push("a console call whose end cannot be found");
    else if (/\.message\b/.test(args)) found.push(`prints a message: ${args.trim()}`);
  }
  for (const { name, body } of catchBlocks(text)) {
    for (const args of consoleCalls(body)) {
      const raw = (args ?? "").replace(new RegExp(`errorText\\(\\s*${name}\\b`, "g"), "");
      if (new RegExp(`\\b${name}\\b`).test(raw)) {
        found.push(`prints the caught ${name} without errorText: ${(args ?? "").trim()}`);
      }
    }
  }
  return found;
}

describe("the scan itself", () => {
  it.each([
    ["a message", "try {} catch (error) { console.error(`🛑 ${error.message}`); }"],
    [
      "a guarded message",
      "catch (e) { console.error(e instanceof Error ? e.message : String(e)); }",
    ],
    ["a name and a message", "console.warn(`${err.name}: ${err.message}`);"],
    ["a message on a new line", "console.log(\n  'x',\n  error\n    .message,\n);"],
    ["a raw caught error", "try {} catch (error) { console.error(error); }"],
    [
      "a caught error in a template",
      "try {} catch (oops) { console.error(`🛑 ${String(oops)}`); }",
    ],
    ["a call that never ends", "console.error(`🛑 ${errorText(error)}`"],
    ["a message after a template", "console.error(`n'a pas (${a}`, e.message);"],
  ])("catches %s", (_label, source) => {
    expect(violations(source)).not.toEqual([]);
  });

  it.each([
    ["errorText", "try {} catch (error) { console.error(`🛑 ${errorText(error, [KeyError])}`); }"],
    ["a parenthesis inside a string", 'console.error("usage : (a", errorText(error));'],
    ["a message of something else", "console.log(`${proposal.subject}`);"],
    ["an apostrophe in a template", "console.log(`rien n'a été ${fait(x)} (ok)`);"],
  ])("lets %s through", (_label, source) => {
    expect(violations(source)).toEqual([]);
  });
});

describe("every program", () => {
  const all = sources();

  it("is scanned, the CLI scripts and the bots included", () => {
    const paths = all.map((s) => s.path);
    for (const expected of [
      "apps/cli/src/mail-sort.ts",
      "apps/cli/src/regles-domaines.ts",
      "apps/cli/src/mesure-rangement.ts",
      "apps/iris/src/draft-main.ts",
      "apps/executor/src/main.ts",
      "apps/telegram/src/handler.ts",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("never prints the message of an error it does not know", () => {
    const found = all.flatMap(({ path, text }) => violations(text).map((v) => `${path}: ${v}`));
    expect(found).toEqual([]);
  });
});
