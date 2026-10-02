import { describe, expect, it } from "vitest";
import { assertTestMailbox, loadFixtures, NotATestMailboxError } from "./test-mailbox.ts";

const base = { port: 3143, user: "test-cenacle", password: "x" };

describe("the fixture loader never touches a real mailbox", () => {
  it.each(["imap.example.com", "100.76.0.1", "192.168.1.10", "0.0.0.0", "mail.cenacle.test"])(
    "refuses the non-local host %s",
    (host) => {
      expect(() => assertTestMailbox({ ...base, host })).toThrow(NotATestMailboxError);
    },
  );

  it("refuses before opening any connection", async () => {
    await expect(loadFixtures({ ...base, host: "imap.example.com" }, [])).rejects.toThrow(
      NotATestMailboxError,
    );
  });
});
