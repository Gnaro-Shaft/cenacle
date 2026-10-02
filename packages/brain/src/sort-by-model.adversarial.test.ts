// What reaches the journal: counts and states, never which mail went where.
import { type MailForModel, projectStatus } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import type { Classification } from "./classify.ts";
import { ModelUnavailableError } from "./iris.ts";
import { createLocalModels } from "./local-model.ts";
import { sortByModel } from "./sort-by-model.ts";
import { memoryJournal } from "./test-helpers.ts";

const local = createLocalModels({ baseUrl: "http://127.0.0.1:9/v1", modelId: "m" });
const mails: MailForModel[] = [1, 2, 3].map((uid) => ({
  uid,
  fromName: "Secret Name",
  domain: "secret-client.example",
  subject: "Secret subject",
  text: "Secret body",
}));
const ok =
  (category: Classification["category"], valid = true) =>
  async (mail: MailForModel): Promise<Classification> => ({
    uid: mail.uid,
    category,
    valid,
    durationMs: 5,
  });

describe("sortByModel", () => {
  it("counts per category, then rests — no content in the journal", async () => {
    const journal = memoryJournal();
    const result = await sortByModel(mails, { journal, local, classify: ok("bruit") });
    expect(result.counts).toEqual({
      clients_prospects: 0,
      administratif: 0,
      bruit: 3,
      a_trier: 0,
      invalid: 0,
    });
    expect(journal.events.map((e) => e.type)).toEqual([
      "model.routed",
      "state.changed",
      "mail.sorted_by_model",
      "state.changed",
    ]);
    expect(JSON.stringify(journal.events.map((e) => e.payload))).not.toMatch(/[Ss]ecret|"uid"/);
    expect(projectStatus("iris", journal.events).internal).toBe("idle");
  });

  it("counts invalid answers, which went to À trier", async () => {
    const journal = memoryJournal();
    const result = await sortByModel(mails, { journal, local, classify: ok("a_trier", false) });
    expect(result.counts).toMatchObject({ a_trier: 3, invalid: 3 });
  });

  it("waits for the Mac when the model stops answering: no guess for the rest", async () => {
    const journal = memoryJournal();
    let calls = 0;
    const result = await sortByModel(mails, {
      journal,
      local,
      classify: async (mail) => {
        if (++calls > 1) throw new ModelUnavailableError("asleep");
        return ok("administratif")(mail);
      },
    });
    expect(result.classified).toHaveLength(1);
    expect(result.waiting).toBe(2);
    const status = projectStatus("iris", journal.events);
    expect(status.internal).toBe("waiting_for_local_model");
    expect(status.view.note).toBe("waiting_for_mac");
  });

  it("an unexpected error turns Iris sick and is rethrown", async () => {
    const journal = memoryJournal();
    const boom = new Error("boom");
    await expect(
      sortByModel(mails, {
        journal,
        local,
        classify: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
    expect(projectStatus("iris", journal.events).view.visual).toBe("sick");
  });
});
