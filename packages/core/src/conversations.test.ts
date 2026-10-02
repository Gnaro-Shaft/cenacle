import { describe, expect, it } from "vitest";
import { conversationIds, countConversations } from "./conversations.ts";

describe("conversations", () => {
  it("links a reply to the mail it answers, and a later reply to the chain", () => {
    const mails = [
      { messageKey: "m1", threadKeys: [] },
      { messageKey: "s1", threadKeys: ["m1"] },
      { messageKey: "m2", threadKeys: ["m1", "s1"] },
      { messageKey: "m9", threadKeys: [] },
    ];
    const ids = conversationIds(mails);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(countConversations(mails)).toBe(1);
  });

  it("joins two mails that answer the same one, even if that one is unknown", () => {
    expect(
      countConversations([
        { messageKey: "a", threadKeys: ["gone"] },
        { messageKey: "b", threadKeys: ["gone"] },
      ]),
    ).toBe(1);
  });

  it("never joins mails without keys", () => {
    expect(
      countConversations([
        { messageKey: null, threadKeys: [] },
        { messageKey: null, threadKeys: [] },
      ]),
    ).toBe(0);
  });
});
