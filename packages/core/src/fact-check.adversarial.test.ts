// The evaluation set: hand-written drafts for the due follow-ups. Good ones
// must pass, and every invented fact of the bad ones must be caught — exactly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDraft } from "./fact-check.ts";
import { loadFixtureMailbox } from "./fixtures.ts";

interface EvalDraft {
  readonly id: string;
  readonly mail: string;
  readonly ok: boolean;
  readonly text: string;
  readonly unsupported: readonly string[];
}
const set = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", "drafts.json"), "utf8"),
) as { drafts: EvalDraft[] };
const mails = new Map(loadFixtureMailbox().messages.map((m) => [m.id, m]));
const SIGNATURE = "Genaro-Cedric Nisus — Gnaro";

describe("fact checker on the evaluation set", () => {
  it.each(set.drafts.map((d) => [d.id, d] as const))("%s", (_id, d) => {
    const mail = mails.get(d.mail);
    if (mail === undefined) throw new Error(`unknown mail ${d.mail}`);
    expect(mail.expected.followUp, "drafts answer due follow-ups only").toBe("due");
    const check = checkDraft(d.text.replace("{signature}", SIGNATURE), [
      mail.subject,
      mail.body,
      SIGNATURE,
    ]);
    expect(check.ok).toBe(d.ok);
    expect(check.unsupported.map((f) => `${f.kind}:${f.value}`).sort()).toEqual(
      [...d.unsupported].sort(),
    );
  });

  it("covers every kind of invented fact", () => {
    const kinds = new Set(set.drafts.flatMap((d) => d.unsupported.map((u) => u.split(":")[0])));
    expect([...kinds].sort()).toEqual([
      "date",
      "email",
      "number",
      "phone",
      "time",
      "url",
      "weekday",
    ]);
  });

  it("never throws on hostile text", () => {
    for (const text of [
      "",
      "@@@",
      "h".repeat(10_000),
      "0".repeat(5000),
      "http://",
      "99/99/99",
      "32 décembre",
    ]) {
      expect(() => checkDraft(text, [text])).not.toThrow();
    }
  });
});
