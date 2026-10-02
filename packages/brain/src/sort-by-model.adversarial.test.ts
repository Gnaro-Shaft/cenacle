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

/** A journal where a pass already fetched the 3 mails and the rules left them all. */
async function journalAfterRules(): Promise<ReturnType<typeof memoryJournal>> {
  const journal = memoryJournal();
  await journal.append({
    agent: "iris",
    type: "mail.fetched",
    payload: { count: 3, truncated: false, durationMs: 1 },
  });
  await journal.append({
    agent: "iris",
    type: "mail.sorted_by_rules",
    payload: { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, remaining: 3 },
  });
  return journal;
}

describe("sortByModel", () => {
  it("counts per category, then rests — no content in the journal", async () => {
    const journal = await journalAfterRules();
    const result = await sortByModel(mails, { journal, local, classify: ok("bruit") });
    expect(result.counts).toEqual({
      clients_prospects: 0,
      administratif: 0,
      bruit: 3,
      a_trier: 0,
      invalid: 0,
    });
    expect(journal.events.map((e) => e.type)).toEqual([
      "mail.fetched",
      "mail.sorted_by_rules",
      "model.routed",
      "state.changed",
      "mail.model_sorted",
      "mail.model_sorted",
      "mail.model_sorted",
      "mail.sorted_by_model",
      "state.changed",
    ]);
    expect(JSON.stringify(journal.events.map((e) => e.payload))).not.toMatch(/[Ss]ecret|"uid"/);
    const status = projectStatus("iris", journal.events);
    expect(status.internal).toBe("idle");
    expect(status.mail).toEqual({
      clients_prospects: 0,
      administratif: 0,
      bruit: 3,
      a_trier: 0,
      pending: 0,
    });
  });

  it("counts invalid answers, which went to À trier", async () => {
    const journal = await journalAfterRules();
    const result = await sortByModel(mails, { journal, local, classify: ok("a_trier", false) });
    expect(result.counts).toMatchObject({ a_trier: 3, invalid: 3 });
  });

  it("waits for the Mac when the model stops answering: no guess for the rest", async () => {
    const journal = await journalAfterRules();
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
    expect(status.mail?.pending).toBe(2);
  });

  it("an unexpected error turns Iris sick and is rethrown", async () => {
    const journal = await journalAfterRules();
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
