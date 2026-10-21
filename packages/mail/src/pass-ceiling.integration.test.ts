// Needs the test mail server: npm run db:up (starts GreenMail too).
// ADR-0030 in production's own pass: a mass mail from an administratif domain
// is read by the model, and its answer never rises above "administratif" —
// in the base, in the journal and in the counters alike. A model that calls
// everything a client stands in for the real one.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLocalModels } from "@cenacle/brain";
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { beforeAll, describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";
import { createKeyer } from "./keys.ts";
import { runMailPass } from "./pass.ts";
import { EXAMPLE_RULES_PATH, loadRules } from "./rules.ts";
import { memoryJournal, memoryMailStore } from "./test-helpers.ts";
import { memoryLocationStore } from "./test-locations.ts";
import { loadFixtures, testMailboxConfigFromEnv } from "./test-mailbox.ts";

for (const name of [".env", ".env.mail"]) {
  const envFile = join(import.meta.dirname, "..", "..", "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const { password } = testMailboxConfigFromEnv();
const { mail } = loadCadre(CADRE_PATH);
const { messages } = loadFixtureMailbox();
const keyer = createKeyer("8".repeat(64));
const idOf = new Map(messages.map((m) => [keyer.messageId(`${m.id}@fixtures.cenacle.test`), m.id]));

describe("the pass caps a mass mail of an administratif domain (GreenMail)", () => {
  beforeAll(async () => {
    await loadFixtures(testMailboxConfigFromEnv(), messages, {
      reset: true,
      sent: loadFixtureSent(),
    });
  });

  it("the model's 'client' is kept as administratif there, and only there", async () => {
    const store = memoryMailStore();
    const journal = memoryJournal();
    const { rules, noFollowUp } = loadRules({
      local: "/nonexistent/x.toml",
      example: EXAMPLE_RULES_PATH,
    });
    const asked: number[] = [];
    await runMailPass({
      journal,
      store,
      locations: memoryLocationStore(),
      keyer,
      cadre: mail,
      retentionDays: 90,
      opposedKeys: async () => new Set(),
      notBefore: null,
      password,
      rules,
      noFollowUp,
      // Never called: the classifier below stands in for it.
      local: createLocalModels({ baseUrl: "http://127.0.0.1:9/v1", modelId: "fake" }),
      classify: async (m) => {
        asked.push(m.uid);
        return { uid: m.uid, category: "clients_prospects", valid: true, durationMs: 0 };
      },
    });
    const byId = new Map(
      (await store.inbox()).map((i) => [idOf.get(i.messageKey ?? "") ?? "?", i]),
    );
    for (const id of ["m152", "m154", "m166"]) {
      expect(byId.get(id), id).toMatchObject({ category: "administratif", decidedBy: "model" });
    }
    // No ceiling where no administratif rule meets a mass mail.
    for (const id of ["m161", "m164"]) {
      expect(byId.get(id), id).toMatchObject({ category: "clients_prospects", decidedBy: "model" });
    }
    // A mass mail of an unknown domain never reaches the model.
    expect(byId.get("m148")).toMatchObject({ category: "bruit", decidedBy: "masse" });
    // The journal says what the base says.
    const modelItems = [...byId.values()].filter((i) => i.decidedBy === "model");
    const journaled = journal.events
      .filter((e) => e.type === "mail.model_sorted")
      .map((e) => (e.payload as { category: string }).category);
    expect(journaled.length).toBe(modelItems.length);
    expect(journaled.filter((c) => c === "administratif").length).toBe(
      modelItems.filter((i) => i.category === "administratif").length,
    );
    expect(asked.length).toBe(modelItems.length);
  });
});
