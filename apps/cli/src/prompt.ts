/**
 * Questions at the terminal, read line after line from one reader (a second
 * reader would lose what was already typed or piped). A secret is not echoed
 * when the input is a terminal; piped input is never echoed anyway.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";

export interface Prompt {
  ask(question: string): Promise<string>;
  /** Not echoed on a terminal. */
  secret(question: string): Promise<string>;
  close(): void;
}

export function createPrompt(): Prompt {
  const tty = stdin.isTTY === true;
  const pending: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let ended = false;
  let muted = false;
  const rl = createInterface({ input: stdin, output: stdout, terminal: tty });
  // readline echoes what is typed through this method: silenced for a secret.
  const echo = rl as unknown as { _writeToOutput: (s: string) => void };
  echo._writeToOutput = (s: string) => {
    if (!muted) stdout.write(s);
  };
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next !== undefined) next(line);
    else pending.push(line);
  });
  rl.on("close", () => {
    ended = true;
    for (const w of waiting.splice(0)) w(null);
  });
  const nextLine = (): Promise<string | null> => {
    const line = pending.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  };
  const read = async (question: string, hidden: boolean): Promise<string> => {
    stdout.write(question);
    muted = hidden && tty;
    const line = await nextLine();
    if (muted) stdout.write("\n");
    muted = false;
    if (line === null) throw new Error("réponse manquante : rien n'a été fait");
    return line.trim();
  };
  return {
    ask: (q) => read(q, false),
    secret: (q) => read(q, true),
    close: () => rl.close(),
  };
}
