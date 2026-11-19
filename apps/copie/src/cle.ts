/**
 * My private key, typed or pasted at the terminal, never shown (ADR-0044,
 * point 7): no echo, held in memory for age's input alone — never an
 * argument, the environment or a file. Pasting the three lines age-keygen
 * prints works: the comment lines are passed over, the key line is kept.
 * Not a terminal (a pipe, launchd): refused — the key is not to be scripted.
 */
import { CopieError } from "./export.ts";

/** What is needed of a terminal: the standard input, in raw mode. */
export interface KeyInput {
  readonly isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

const MAX_LINE = 200;
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACES = new Set(["\u007f", "\b"]);

export function readHiddenKey(input: KeyInput, say: (text: string) => void): Promise<string> {
  if (input.isTTY !== true || input.setRawMode === undefined) {
    return Promise.reject(
      new CopieError("la clé privée se tape au terminal, jamais par un tube : rien n'est restauré"),
    );
  }
  const raw = input.setRawMode.bind(input);
  say("Clé privée age (AGE-SECRET-KEY-1…, rien ne s'affiche) : ");
  raw(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolve, reject) => {
    let line = "";
    const finish = (error: CopieError | null) => {
      input.off("data", onData);
      raw(false);
      input.pause();
      say("\n");
      if (error === null) resolve(line.trim());
      else reject(error);
      line = "";
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === CTRL_C || ch === CTRL_D) {
          return finish(new CopieError("abandonné : rien n'est restauré"));
        }
        if (ch === "\r" || ch === "\n") {
          // A comment line pasted with the key (# created, # public key): passed over.
          if (line.trim().startsWith("AGE-SECRET-KEY-")) return finish(null);
          line = "";
          continue;
        }
        if (BACKSPACES.has(ch)) line = line.slice(0, -1);
        else if (line.length < MAX_LINE) line += ch;
      }
    };
    input.on("data", onData);
  });
}
