// The platform survey shows exact sender addresses and link hosts, nothing
// else: a display name never makes a platform, a link's path never shows,
// a dangerous link never counts as a host, and a copy counts once.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORDS,
  ranked,
  surveyArgs,
  tallyPlatforms,
  WORD_RULE,
} from "./prospection-tally.ts";

const mail = (from: string, html: string, subject = "Nouvelles missions") =>
  Buffer.from(
    `From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`,
    "utf8",
  );
const ALERT = mail(
  "Plateforme <alertes@plateforme.example>",
  `<a href="https://clic.plateforme.example/r?u=moi%40perso.example&id=42">Mission 1</a>
   <a href="https://clic.plateforme.example/r?id=43">Mission 2</a>
   <a href="https://www.plateforme.example/missions/9">Voir</a>
   <a href="javascript:alert(1)">piège</a> <a href="http://ancien.plateforme.example/">http</a>`,
);

describe("the platform survey", () => {
  it("counts the sender address and each link host once per mail", async () => {
    const t = (await tallyPlatforms([ALERT], ["plateforme"])).get("plateforme");
    expect(t?.mails).toBe(1);
    expect(ranked(t?.senders ?? new Map())).toEqual([["alertes@plateforme.example", 1]]);
    expect(ranked(t?.hosts ?? new Map())).toEqual([
      ["clic.plateforme.example", 1],
      ["www.plateforme.example", 1],
    ]);
  });

  it("never shows a path, a query or the subject: hosts and addresses only", async () => {
    const shown = JSON.stringify(
      [...(await tallyPlatforms([ALERT], ["plateforme"]))].map(([w, t]) => [
        w,
        ranked(t.senders),
        ranked(t.hosts),
      ]),
    );
    expect(shown).not.toMatch(/perso\.example|id=|missions\/9|Nouvelles|Mission/);
  });

  it("a display name that says the platform does not make one", async () => {
    const forged = mail(
      '"plateforme.example" <x@attacker.test>',
      '<a href="https://attacker.test/">x</a>',
    );
    expect((await tallyPlatforms([forged], ["plateforme"])).get("plateforme")?.mails).toBe(0);
  });

  it("the same mail in two folders counts once", async () => {
    expect((await tallyPlatforms([ALERT, ALERT], ["plateforme"])).get("plateforme")?.mails).toBe(1);
  });

  it("an unreadable sender is skipped, never guessed", async () => {
    const two = mail("a@plateforme.example, b@plateforme.example", "x");
    expect(
      (await tallyPlatforms([two, Buffer.from("garbage")], ["plateforme"])).get("plateforme")
        ?.mails,
    ).toBe(0);
  });

  it.each(["", "a", "LinkedIn", "x y", "evil;rm", "-rf", "a".repeat(41)])(
    "refuses the word %j",
    (word) => {
      expect(WORD_RULE.test(word)).toBe(false);
    },
  );

  it("accepts plain platform words", () => {
    for (const w of ["linkedin", "free-work", "malt", "collective", "malt.fr"]) {
      expect(WORD_RULE.test(w)).toBe(true);
    }
  });

  it("reads the words and the days in any order, never dropping a word", () => {
    expect(surveyArgs([])).toEqual({ days: 60, words: DEFAULT_WORDS });
    expect(surveyArgs(["malt"])).toEqual({ days: 60, words: ["malt"] });
    expect(surveyArgs(["malt", "--jours", "30", "collective"])).toEqual({
      days: 30,
      words: ["malt", "collective"],
    });
    expect(surveyArgs(["--jours", "7"])).toEqual({ days: 7, words: DEFAULT_WORDS });
  });

  it.each([["--jours"], ["--jours", "0"], ["--jours", "abc"], ["--jours", "400"], ["x;y"]])(
    "refuses %j with words of the code",
    (...args) => {
      expect(typeof surveyArgs(args)).toBe("string");
    },
  );
});
