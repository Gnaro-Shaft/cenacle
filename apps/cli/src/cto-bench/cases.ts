/**
 * The bench of the CTO's review (phase 6, J3b — ADR-0021), written before the
 * review it measures: six commits that introduced a real defect, fixed since.
 * Each case says what a review must name, in one paragraph, to count as found.
 * The criteria are fixed here, in their own commit: never fitted to a result.
 *
 * Threshold decided on 2026-10-09: 3 of 6 to drop "experimental"; below 2 of
 * 6, a stronger model is to be considered (a new ADR).
 */

export interface BenchCase {
  readonly id: string;
  readonly commit: string;
  /** What the defect is, for the report. */
  readonly defect: string;
  /** Fixed by. */
  readonly fixedBy: string;
  /** Every pattern must match the same paragraph of the review. */
  readonly mustMention: readonly RegExp[];
}

export const BENCH: readonly BenchCase[] = [
  {
    id: "A",
    commit: "e314f53",
    defect: "launchd: bootstrap right after bootout, while the job may still be stopping",
    fixedBy: "78246c2",
    mustMention: [
      /bootout/i,
      /bootstrap/i,
      /(attend|arr[êe]t|course|encore|imm[ée]diat|wait|stop)/i,
    ],
  },
  {
    id: "B",
    commit: "ab89ebe",
    defect: "mail.set_aside written but not declared in the projection: Iris shows sick",
    fixedBy: "2e491d4",
    mustMention: [
      /mail\.set_aside/,
      /(projection|agent-status|inconnu|d[ée]clar|malade|sick|unknown)/i,
    ],
  },
  {
    id: "C",
    commit: "0f3afa1",
    defect:
      "a raw 8-bit UTF-8 subject read from the IMAP envelope as Latin-1: mojibake in the reply",
    fixedBy: "948406c",
    mustMention: [
      /(sujet|subject)/i,
      /(latin|utf-?8|mojibake|encodage|encoding|8 ?bits?|d[ée]cod)/i,
    ],
  },
  {
    id: "D",
    commit: "fa2fac8",
    defect:
      'a test mutation replace(/^./, "A") is a no-op when the signature already starts with A',
    fixedBy: "a47e83c",
    mustMention: [
      /(replace|premier caract[èe]re|first char)/i,
      /signature/i,
      /(inchang|no-?op|identique|m[êe]me|d[ée]j[àa]|commence|starts? with|valide|valid)/i,
    ],
  },
  {
    id: "E",
    commit: "4ea383c",
    defect:
      "purge.done / purge.failed written but not declared in the projection; a failed purge unseen",
    fixedBy: "2e491d4",
    // Corrected after the first J3b run (2026-10-09), and said so: "unknown"
    // matched a cited line of code (`error.name : "unknown"`) in a paragraph
    // about something else. The run is counted with the stricter reading.
    mustMention: [
      /purge\.(done|failed)/,
      /(projection|agent-status|inconnu|d[ée]clar|malade|sick|silenc)/i,
    ],
  },
  {
    id: "F",
    commit: "08b2cb5",
    defect: "the reply subject strips C0 and DEL but not C1 control characters (NEL)",
    fixedBy: "948406c",
    mustMention: [
      /(C1|NEL|U\+0080|U\+009F|0x80|0x9f|0x85|caract[èe]res? de contr[ôo]le|control char)/i,
      /(sujet|subject|en-t[êe]te|header)/i,
    ],
  },
];

/** Paragraphs of a review: what a finding may span. */
export function paragraphs(review: string): string[] {
  return review
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Found when one paragraph matches every pattern of the case. */
export function found(review: string, c: BenchCase): boolean {
  return paragraphs(review).some((p) => c.mustMention.every((re) => re.test(p)));
}
