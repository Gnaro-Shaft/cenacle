// The journal of proposals: ids and outcomes only, never the draft; the
// bubble on Iris's box follows the proposals waiting for me.
import { projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { createProposals } from "./proposals.ts";
import { memoryJournal, memoryProposalStore } from "./test-helpers.ts";

const SECRET = "Bonjour Claire, votre TJM secret";
const T0 = new Date("2026-10-05T10:00:00Z");

describe("proposals and the journal", () => {
  it("the bubble counts what waits for me; the journal never holds the draft", async () => {
    const journal = memoryJournal();
    const proposals = createProposals(memoryProposalStore(), journal);
    for (const id of ["p1", "p2", "p3"]) {
      await proposals.propose({
        id,
        mailUidValidity: "1",
        mailUid: Number(id[1]),
        trame: null,
        draft: SECRET,
      });
    }
    expect(projectStatus("iris", journal.events).pendingApprovals).toBe(3);
    await proposals.accept("p1", T0);
    await proposals.refuse("p2", T0);
    await proposals.lapse("p3", T0);
    expect(projectStatus("iris", journal.events).pendingApprovals).toBe(0);
    expect(JSON.stringify(journal.events.map((e) => e.payload))).not.toMatch(/Claire|TJM|Bonjour/);
  });

  it("cancelling or lapsing an accepted proposal is journaled without touching the bubble", async () => {
    const journal = memoryJournal();
    const proposals = createProposals(memoryProposalStore(), journal);
    await proposals.propose({
      id: "p1",
      mailUidValidity: "1",
      mailUid: 1,
      trame: null,
      draft: "x",
    });
    await proposals.propose({
      id: "p2",
      mailUidValidity: "1",
      mailUid: 2,
      trame: null,
      draft: "x",
    });
    await proposals.accept("p1", T0);
    await proposals.accept("p2", T0);
    await proposals.cancel("p1", T0);
    await proposals.lapse("p2", T0);
    expect(journal.events.map((e) => e.type).slice(-2)).toEqual(["send.cancelled", "send.lapsed"]);
    expect(() => projectStatus("iris", journal.events)).not.toThrow();
  });
});
