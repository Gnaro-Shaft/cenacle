import { describe, expect, it } from "vitest";
import { CADRE_PATH, loadCadre } from "./cadre.ts";

describe("cadre.toml", () => {
  it("the versioned file is valid and points at the test mailbox", () => {
    const cadre = loadCadre(CADRE_PATH);
    expect(cadre.mail).toEqual({
      source: "boite-test",
      host: "127.0.0.1",
      port: 3143,
      user: "test-cenacle",
      mailbox: "INBOX",
      sentMailbox: "Sent",
      maxPerFetch: 500,
      smtpPort: 3025,
      address: "test-cenacle@cenacle.test",
      test: true,
      recipients: null,
      readOnly: false,
    });
  });

  it("declares the retentions, and no open processing while only the test mailbox is read", () => {
    const cadre = loadCadre(CADRE_PATH);
    expect(cadre.conservation).toEqual({
      memoireJours: 90,
      texteBrouillonJours: 7,
      propositionsJours: 90,
      journalJours: 180,
    });
    expect(cadre.traitements).toEqual([]);
  });
});
