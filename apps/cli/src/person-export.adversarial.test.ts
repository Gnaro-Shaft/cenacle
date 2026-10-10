// What a person receives (GDPR art. 15 and 20) speaks the notice's words:
// never "bruit", never an internal identifier — a box or a sorter with no
// wording is refused, not handed over raw; and everything else is unchanged.
import type { Holdings } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { BOX_LABEL, DECIDED_BY_LABEL, ExportLabelError, personExport } from "./person-export.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const held = (received: Holdings["received"]): Holdings => ({
  received,
  sentTo: [{ sentAt: "2026-10-02T09:00:00.000Z" }],
  proposals: [
    {
      status: "closed",
      createdAt: "2026-10-03T09:00:00.000Z",
      decidedAt: "2026-10-03T10:00:00.000Z",
      closedAt: "2026-10-03T11:00:00.000Z",
      draft: null,
    },
  ],
  opposed: false,
});
const all = held([
  { receivedAt: "2026-10-01T08:00:00.000Z", category: "bruit", decidedBy: "rule" },
  { receivedAt: "2026-10-01T09:00:00.000Z", category: "clients_prospects", decidedBy: "model" },
  { receivedAt: "2026-10-01T10:00:00.000Z", category: "a_trier", decidedBy: "set_aside" },
  { receivedAt: "2026-10-01T11:00:00.000Z", category: "a_trier", decidedBy: "unauthenticated" },
  { receivedAt: "2026-10-01T12:00:00.000Z", category: "a_trier", decidedBy: "unreadable" },
  { receivedAt: "2026-10-01T13:00:00.000Z", category: "administratif", decidedBy: "rule" },
  { receivedAt: "2026-10-01T14:00:00.000Z", category: null, decidedBy: null },
]);

describe("the export a person receives", () => {
  it("never holds 'bruit' nor any internal identifier", () => {
    const text = JSON.stringify(personExport(all, NOW));
    for (const id of [
      "bruit",
      "clients_prospects",
      "a_trier",
      '"rule"',
      '"model"',
      "set_aside",
      "unauthenticated",
      "unreadable",
      "category",
      "decidedBy",
    ]) {
      expect(text).not.toContain(id);
    }
  });

  it("speaks the notice's words, box by box", () => {
    const got = personExport(all, NOW).ce_que_cenacle_detient.received;
    expect(got.map((m) => [m.case, m.rangePar])).toEqual([
      ["information sans réponse attendue", "une règle"],
      ["client ou prospect", "le modèle local"],
      ["à trier par moi", "mis de côté pour moi, sans le modèle"],
      ["à trier par moi", "mis de côté pour moi, sans le modèle"],
      ["à trier par moi", "mis de côté pour moi, sans le modèle"],
      ["administratif", "une règle"],
      ["pas encore rangé", null],
    ]);
  });

  it("never says why a mail was set aside: the three reasons read the same", () => {
    const reasons = new Set(
      (["set_aside", "unauthenticated", "unreadable"] as const).map((k) => DECIDED_BY_LABEL[k]),
    );
    expect(reasons.size).toBe(1);
  });

  it("the notice's own words for each box (mention-information.md)", () => {
    expect(BOX_LABEL.bruit).toBe("information sans réponse attendue");
    expect(Object.keys(BOX_LABEL).sort()).toEqual(
      ["a_trier", "administratif", "bruit", "clients_prospects"].sort(),
    );
  });

  it("a box or a sorter with no wording is refused, never handed over raw", () => {
    const odd = (category: string, decidedBy: string) =>
      held([{ receivedAt: "2026-10-01T08:00:00.000Z", category, decidedBy } as never]);
    expect(() => personExport(odd("spam", "rule"), NOW)).toThrow(ExportLabelError);
    expect(() => personExport(odd("bruit", "manual"), NOW)).toThrow(ExportLabelError);
    expect(() => personExport(odd("toString", "rule"), NOW)).toThrow(ExportLabelError);
    try {
      personExport(odd("spam", "rule"), NOW);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("spam");
    }
  });

  it("everything else is unchanged: dates, sent mails, proposals, opposition", () => {
    const doc = personExport({ ...all, opposed: true }, NOW);
    expect(doc.exporte_le).toBe(NOW.toISOString());
    expect(doc.ce_que_cenacle_detient.sentTo).toEqual(all.sentTo);
    expect(doc.ce_que_cenacle_detient.proposals).toEqual(all.proposals);
    expect(doc.ce_que_cenacle_detient.opposed).toBe(true);
    expect(doc.ce_que_cenacle_detient.received.map((m) => m.receivedAt)).toEqual(
      all.received.map((m) => m.receivedAt),
    );
    expect(doc.ce_qui_n_est_pas_inclus).toHaveLength(3);
  });
});
