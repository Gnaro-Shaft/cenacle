// The buttons under a finding (J6b): their data fits Telegram's 64 bytes and
// is read strictly — any other shape, a forged id or token, is ignored; a
// decided finding loses its own row only; and no message carries more than
// ten rows.
import { describe, expect, it } from "vitest";
import {
  keyboard,
  MAX_BUTTON_DATA,
  MAX_BUTTON_ROWS,
  parsePressed,
  withoutFinding,
} from "./buttons.ts";
import { formatWeekly, type ReportFinding } from "./report.ts";

// A fake button token, built by pieces (not a secret: a test value).
const TOKEN = ["01234567", "89abcdef"].join("");

describe("the buttons", () => {
  it("three per finding, each within 64 bytes, read back exactly", () => {
    const rows = keyboard([{ id: 999_999_999_999, token: TOKEN }]);
    expect(rows[0]?.map((b) => b.text)).toEqual([
      "✅ n°999999999999 je m'en occupe",
      "☑ n°999999999999 risque",
      "❌ n°999999999999 refuser",
    ]);
    for (const b of rows[0] ?? []) {
      expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(MAX_BUTTON_DATA);
    }
    expect(rows[0]?.map((b) => parsePressed(b.data))).toEqual([
      { id: 999_999_999_999, action: "take", token: TOKEN },
      { id: 999_999_999_999, action: "keep", token: TOKEN },
      { id: 999_999_999_999, action: "refuse", token: TOKEN },
    ]);
  });

  it.each([
    ["no data", undefined],
    ["a number", 12],
    ["another prefix", `x:1:t:${TOKEN}`],
    ["an unknown action", `s:1:z:${TOKEN}`],
    ["a short token", "s:1:t:0123"],
    ["an uppercase token", `s:1:t:${TOKEN.toUpperCase()}`],
    ["a zero id", `s:0:t:${TOKEN}`],
    ["a negative id", `s:-1:t:${TOKEN}`],
    ["an id too long", `s:1234567890123:t:${TOKEN}`],
    ["something after", `s:1:t:${TOKEN}:x`],
    ["something before", ` s:1:t:${TOKEN}`],
    ["too long", `s:1:t:${TOKEN}${"a".repeat(60)}`],
  ])("ignores %s", (_, data) => {
    expect(parsePressed(data)).toBeNull();
  });

  it("a decided finding loses its own row; the others stay", () => {
    const rows = keyboard([
      { id: 1, token: TOKEN },
      { id: 12, token: TOKEN },
    ]);
    expect(withoutFinding(rows, 1).map((r) => parsePressed(r[0]?.data)?.id)).toEqual([12]);
    expect(withoutFinding(rows, 2)).toHaveLength(2);
  });

  it("at most ten rows in one message", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, token: TOKEN }));
    expect(keyboard(many)).toHaveLength(MAX_BUTTON_ROWS);
  });
});

describe("the weekly review (J6b)", () => {
  const NOW = new Date("2026-10-19T05:30:00Z");
  const f = (id: number, takenAt: Date | null): ReportFinding => ({
    id,
    type: "firewall_off",
    target: "mac",
    occurrence: "off",
    severity: "moyen",
    title: `Constat ${id}`,
    params: {},
    firstSeen: new Date("2026-10-10T05:30:00Z"),
    takenAt,
  });

  it("taken in hand apart; over a week, flagged as still not fixed", () => {
    const text = formatWeekly({
      date: NOW,
      open: [
        f(1, null),
        f(2, new Date("2026-10-17T05:30:00Z")),
        f(3, new Date("2026-10-11T05:30:00Z")),
      ],
      accepted: [],
    });
    expect(text).toMatch(/1 constat\(s\) à traiter, 2 pris en charge/);
    expect(text).toMatch(/🔧 Pris en charge le 17 octobre · Constat 2/);
    expect(text).toMatch(/⏰ Pris en charge le 11 octobre, toujours pas corrigé · Constat 3/);
  });
});
