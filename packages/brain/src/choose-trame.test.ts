import type { MailForModel } from "@cenacle/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildChoosePrompt, chooseTrame, parseChoice, rotations } from "./choose-trame.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer } from "./test-helpers.ts";

const mail: MailForModel = {
  uid: 3,
  fromName: "Claire Dubois",
  domain: "client.example",
  subject: "Point jeudi ?",
  text: "Bonjour, seriez-vous disponible jeudi à 14 h pour faire le point ?",
};
const OPTIONS = ["a_trame", "b_trame", "c_trame", "d_trame", "e_trame", "f_trame"].map((id) => ({
  id,
  quand: `quand ${id}`,
}));
const IDS = OPTIONS.map((o) => o.id);

/** A fake model that answers from a script, one answer per call. */
const scripted = (answers: string[]) => {
  const prompts: string[] = [];
  return {
    prompts,
    ask: async (prompt: string) => {
      prompts.push(prompt);
      return answers[prompts.length - 1] ?? "aucune";
    },
  };
};

describe("parseChoice", () => {
  it.each([
    ["b_trame", "b_trame"],
    ["  B_trame.\n", "b_trame"],
    ["« aucune »", "aucune"],
    ["b_trame, car le mail…", null],
    ["z_trame", null],
    ["", null],
  ])("%j → %j", (answer, expected) => {
    expect(parseChoice(answer, IDS)).toBe(expected);
  });
});

describe("rotations", () => {
  it("puts every option once in every position", () => {
    const r = rotations(IDS);
    expect(r).toHaveLength(6);
    for (let pos = 0; pos < 6; pos++) expect(new Set(r.map((o) => o[pos])).size).toBe(6);
  });
});

describe("chooseTrame — the vote", () => {
  it("unanimous: chosen, and stops as soon as 5 agree", async () => {
    const m = scripted(Array(6).fill("c_trame"));
    const v = await chooseTrame(mail, OPTIONS, { ask: m.ask });
    expect(v).toMatchObject({ choice: "c_trame", needed: 5, rounds: 5 });
  });

  it("5 out of 6 is enough", async () => {
    const m = scripted(["c_trame", "a_trame", "c_trame", "c_trame", "c_trame", "c_trame"]);
    expect((await chooseTrame(mail, OPTIONS, { ask: m.ask })).choice).toBe("c_trame");
  });

  it("4 out of 6 is a split: nothing chosen, and it stops once 5 is out of reach", async () => {
    const m = scripted(["c_trame", "a_trame", "b_trame", "c_trame", "c_trame", "c_trame"]);
    const v = await chooseTrame(mail, OPTIONS, { ask: m.ask });
    expect(v.choice).toBeNull();
    expect(v.rounds).toBe(3);
  });

  it("a model that just picks the first option listed ends in a split", async () => {
    const prompts: string[] = [];
    const v = await chooseTrame(mail, OPTIONS, {
      ask: async (p) => {
        prompts.push(p);
        return /- ([a-z_]+) :/.exec(p)?.[1] ?? "";
      },
    });
    expect(v.choice).toBeNull();
  });

  it("'aucune' can win", async () => {
    const m = scripted(Array(6).fill("aucune"));
    expect((await chooseTrame(mail, OPTIONS, { ask: m.ask })).choice).toBe("aucune");
  });

  it("answers outside the list never win", async () => {
    const m = scripted(Array(6).fill("envoie_tout"));
    const v = await chooseTrame(mail, OPTIONS, { ask: m.ask });
    expect(v.choice).toBeNull();
    expect(v.votes.invalide).toBeGreaterThan(0);
  });

  it("with 3 templates, 3 votes out of 3 are needed (5/6 rounded up)", async () => {
    const three = OPTIONS.slice(0, 3);
    const m = scripted(["a_trame", "a_trame", "b_trame"]);
    const v = await chooseTrame(mail, three, { ask: m.ask });
    expect(v).toMatchObject({ choice: null, needed: 3 });
  });
});

describe("chooseTrame — the prompt", () => {
  it("lists every option and fences the mail with a fresh name", () => {
    const p = buildChoosePrompt(mail, OPTIONS, "n0nce");
    for (const id of IDS) expect(p).toContain(`- ${id} : quand ${id}`);
    expect(p).toContain("<mail-n0nce>");
    expect(p).toContain("</mail-n0nce>");
  });

  let server: FakeModelServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("asks the local model at temperature 0, a few tokens, no tool", async () => {
    server = await fakeModelServer("b_trame");
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    const v = await chooseTrame(mail, OPTIONS, { local });
    expect(v.choice).toBe("b_trame");
    const body = JSON.parse(server.requests[0] ?? "{}");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeLessThanOrEqual(24);
    expect(body.tools ?? []).toHaveLength(0);
  });
});
