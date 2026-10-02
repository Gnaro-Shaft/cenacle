import type { MailForModel } from "@cenacle/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildClassificationPrompt, classifyMail, parseCategory } from "./classify.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer } from "./test-helpers.ts";

const mail: MailForModel = {
  uid: 7,
  fromName: "Alice Martin",
  domain: "client.example",
  subject: "Devis pour une mission",
  text: "Bonjour, pouvez-vous m'envoyer un devis ?",
};

describe("parseCategory", () => {
  it.each([
    ["bruit", "bruit"],
    ["  Administratif.\n", "administratif"],
    ['"clients_prospects"', "clients_prospects"],
    ["`a_trier`", "a_trier"],
  ])("accepts %j", (answer, category) => {
    expect(parseCategory(answer)).toBe(category);
  });
});

describe("classifyMail", () => {
  let server: FakeModelServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the category the model gives", async () => {
    server = await fakeModelServer("clients_prospects");
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    const result = await classifyMail(mail, { local });
    expect(result).toMatchObject({ uid: 7, category: "clients_prospects", valid: true });
  });

  it("sends the mail inside a fence and caps the answer length", async () => {
    server = await fakeModelServer("bruit");
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    await classifyMail(mail, { local, nonce: () => "abc123" });
    const body = JSON.parse(server.requests[0] ?? "{}");
    const user = JSON.stringify(body.messages);
    expect(user).toContain("<mail-abc123>");
    expect(user).toContain("Devis pour une mission");
    expect(body.max_tokens).toBe(12);
    expect(body.temperature).toBe(0);
    expect(body.tools ?? []).toEqual([]);
  });

  it("builds the prompt with the mail between its fences", () => {
    const prompt = buildClassificationPrompt(mail, "n1");
    const open = prompt.indexOf("<mail-n1>");
    const close = prompt.indexOf("</mail-n1>");
    expect(open).toBeGreaterThan(-1);
    expect(prompt.indexOf(mail.text)).toBeGreaterThan(open);
    expect(prompt.indexOf(mail.text)).toBeLessThan(close);
  });
});
