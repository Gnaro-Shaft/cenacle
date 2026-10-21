// The probe's reasoning column: a model that reasons never shows 0, whichever
// field its server puts the reasoning in, and a server error never shows as
// "no reasoning". Replies are shaped like Ollama's and LM Studio's, values made up.
import { describe, expect, it } from "vitest";
import { type Completion, reasoningShown } from "./reasoning.ts";

const THOUGHT = "Okay, the user wants one sentence about Iris.";
const reply = (message: Record<string, unknown>, usage: Completion["usage"] = {}): Completion =>
  ({ choices: [{ message: { content: "Je suis Iris.", ...message } }], usage }) as Completion;

describe("the probe's reasoning column", () => {
  it("reads Ollama's `reasoning`, which counts no reasoning tokens (corrected 2026-10-20)", () => {
    expect(reasoningShown(reply({ reasoning: THOUGHT }, { completion_tokens: 335 }))).toBe(
      `~${THOUGHT.length} chars`,
    );
  });

  it("reads LM Studio's `reasoning_content`, and prefers the tokens it counts", () => {
    expect(reasoningShown(reply({ reasoning_content: THOUGHT }))).toBe(`~${THOUGHT.length} chars`);
    const counted = {
      completion_tokens: 140,
      completion_tokens_details: { reasoning_tokens: 120 },
    };
    expect(reasoningShown(reply({ reasoning_content: THOUGHT }, counted))).toBe(120);
  });

  it("shows 0 only when nothing says the model reasoned", () => {
    expect(reasoningShown(reply({}))).toBe(0);
    expect(reasoningShown(reply({}, { completion_tokens_details: { reasoning_tokens: 0 } }))).toBe(
      0,
    );
    for (const empty of ["", "  \n\n  "]) {
      expect(reasoningShown(reply({ reasoning: empty, reasoning_content: empty }))).toBe(0);
    }
  });

  it("does not believe a count of 0 next to a reasoning text", () => {
    const zero = { completion_tokens_details: { reasoning_tokens: 0 } };
    expect(reasoningShown(reply({ reasoning: THOUGHT }, zero))).toBe(`~${THOUGHT.length} chars`);
  });

  it("takes whichever field holds text, when both are sent", () => {
    expect(reasoningShown(reply({ reasoning_content: "", reasoning: THOUGHT }))).toBe(
      `~${THOUGHT.length} chars`,
    );
    expect(reasoningShown(reply({ reasoning_content: "abc", reasoning: THOUGHT }))).toBe(
      "~3 chars",
    );
  });

  it("ignores a reasoning field that is not text", () => {
    for (const odd of [42, null, { text: THOUGHT }, [THOUGHT], true]) {
      expect(reasoningShown(reply({ reasoning: odd, reasoning_content: odd }))).toBe(0);
    }
  });

  it("ignores a token count that is not a positive number", () => {
    for (const odd of [-5, "120", null]) {
      const usage = { completion_tokens_details: { reasoning_tokens: odd } } as Completion["usage"];
      expect(reasoningShown(reply({ reasoning: THOUGHT }, usage))).toBe(`~${THOUGHT.length} chars`);
    }
  });

  it("shows ? when the reply holds no message: an error is not an absence of reasoning", () => {
    const odd = [
      null,
      {},
      { error: { message: "model not found" } },
      { choices: [] },
      { choices: [{}] },
      { choices: [{ message: null }] },
      { choices: [{ message: "Je suis Iris." }] },
      { choices: { 0: "x" } },
    ];
    for (const data of odd) expect(reasoningShown(data as Completion | null)).toBe("?");
  });
});
