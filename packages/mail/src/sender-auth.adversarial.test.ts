// A sender writes whatever headers they like, including one that claims to
// come from our server. Only our server's own header, where it puts it and
// alone, may authenticate a From — and only for exactly that domain.
import { describe, expect, it } from "vitest";
import { MAX_FIELDS, orderedHeaders } from "./ordered-headers.ts";
import { senderAuthentication, type TrustedServer } from "./sender-auth.ts";
import { senderDomain } from "./sender-domain.ts";

const OURS: TrustedServer = { authservId: "mx.box.test", receivedAbove: 2 };
const CLIENT = "client.example";
const ar = (value: string) => `Authentication-Results: ${value}`;
const pass = (domain = CLIENT) => ar(`mx.box.test; dmarc=pass header.from=${domain}`);
const internal = ["Received: from filter by store.box.test", "Received: from mx by filter"];
const border = "Received: from relay.sender.test by mx.box.test";

/** Our server's headers on top (2 internal hops, then its verdict), the sender's below. */
function mail({
  top = internal,
  verdict = [pass()],
  sender = [] as string[],
  from = `From: Alice <alice@${CLIENT}>`,
} = {}): string {
  return [...top, ...verdict, border, ...sender, from].join("\r\n");
}
function verdictOf(raw: string, server = OURS) {
  const { fields, truncated } = orderedHeaders(raw);
  const from = fields.filter((f) => f.name === "from");
  const domain = from.length === 1 ? senderDomain(from[0]?.value) : null;
  return senderAuthentication(fields, truncated, domain, server);
}

describe("senderAuthentication — believed", () => {
  it("our header, at its rank, alone: dmarc pass for exactly the From domain", () => {
    expect(verdictOf(mail())).toBe("authenticated");
  });

  it("no DMARC policy (absent or none): a DKIM signature by exactly the From domain", () => {
    const dkim = ar(`mx.box.test; dkim=pass header.d=${CLIENT}`);
    expect(verdictOf(mail({ verdict: [dkim] }))).toBe("authenticated");
    const none = ar(`mx.box.test; dkim=pass header.d=${CLIENT}; dmarc=none header.from=${CLIENT}`);
    expect(verdictOf(mail({ verdict: [none] }))).toBe("authenticated");
  });

  it("server name and From domain in any case", () => {
    const upper = ar("MX.Box.TEST; DMARC=PASS header.from=Client.Example");
    const from = "From: <ALICE@CLIENT.EXAMPLE>";
    expect(verdictOf(mail({ verdict: [upper], from }))).toBe("authenticated");
  });

  it("other servers' headers (the sender's provider, ARC) change nothing", () => {
    const sender = [
      ar(`mx.sender.test; dmarc=fail header.from=${CLIENT}`),
      "ARC-Authentication-Results: i=1; mx.sender.test; dmarc=pass",
    ];
    expect(verdictOf(mail({ sender }))).toBe("authenticated");
  });
});

describe("senderAuthentication — forged or doubtful: never believed", () => {
  it("forged From: DMARC fails", () => {
    const fail = ar(`mx.box.test; dmarc=fail header.from=${CLIENT}; dkim=none`);
    expect(verdictOf(mail({ verdict: [fail] }))).toBe("failed");
  });

  it("a DMARC fail is not saved by a DKIM pass", () => {
    const mixed = ar(`mx.box.test; dkim=pass header.d=${CLIENT}; dmarc=fail header.from=${CLIENT}`);
    expect(verdictOf(mail({ verdict: [mixed] }))).toBe("failed");
  });

  it("a pass for another domain, a parent or a subdomain", () => {
    for (const domain of ["attacker.test", "example", `mail.${CLIENT}`]) {
      expect(verdictOf(mail({ verdict: [pass(domain)] }))).toBe("failed");
      const dkim = ar(`mx.box.test; dkim=pass header.d=${domain}`);
      expect(verdictOf(mail({ verdict: [dkim] }))).toBe("failed");
    }
  });

  it("two DMARC results that disagree", () => {
    const two = ar(
      `mx.box.test; dmarc=pass header.from=${CLIENT}; dmarc=pass header.from=attacker.test`,
    );
    expect(verdictOf(mail({ verdict: [two] }))).toBe("failed");
  });

  it("SPF alone, even aligned", () => {
    const spf = ar(`mx.box.test; spf=pass smtp.mailfrom=bounce@${CLIENT}`);
    expect(verdictOf(mail({ verdict: [spf] }))).toBe("failed");
  });

  it("an unknown result word, a pass with no domain said, no result at all", () => {
    for (const v of [
      `mx.box.test; dmarc=bestpass header.from=${CLIENT}`,
      "mx.box.test; dmarc=pass",
      "mx.box.test; none",
    ]) {
      expect(verdictOf(mail({ verdict: [ar(v)] }))).toBe("failed");
    }
  });

  it("no header from our server at all", () => {
    expect(verdictOf(mail({ verdict: [] }))).toBe("missing");
    const other = ar(`mx.other.test; dmarc=pass header.from=${CLIENT}`);
    expect(verdictOf(mail({ verdict: [other] }))).toBe("missing");
  });

  it("our header missing, the sender's claiming our name below: misplaced", () => {
    expect(verdictOf(mail({ verdict: [], sender: [pass()] }))).toBe("misplaced");
  });

  it("the sender's header claiming our name, next to ours: duplicated", () => {
    expect(verdictOf(mail({ sender: [pass()] }))).toBe("duplicated");
    const fail = ar(`mx.box.test; dmarc=fail header.from=${CLIENT}`);
    expect(verdictOf(mail({ verdict: [fail], sender: [pass()] }))).toBe("duplicated");
  });

  it("a header claiming our name ABOVE ours: duplicated; alone up there: misplaced", () => {
    const injectedOnTop = [pass(), ...internal];
    expect(verdictOf(mail({ top: injectedOnTop }))).toBe("duplicated");
    expect(verdictOf(mail({ top: injectedOnTop, verdict: [] }))).toBe("misplaced");
  });

  it("our name with a comment or a version still counts as a claim of our name", () => {
    for (const claim of [
      `mx.box.test (fake); dmarc=pass header.from=${CLIENT}`,
      `mx.box.test\t1; dmarc=pass header.from=${CLIENT}`,
    ]) {
      expect(verdictOf(mail({ sender: [ar(claim)] }))).toBe("duplicated");
    }
  });

  it("our header where the server no longer puts it (one hop more or less)", () => {
    expect(verdictOf(mail(), { ...OURS, receivedAbove: 3 })).toBe("misplaced");
    expect(verdictOf(mail(), { ...OURS, receivedAbove: 1 })).toBe("misplaced");
  });

  it("our header unreadable", () => {
    for (const v of ["mx.box.test; dmarc=pass (header.from=x", "mx.box.test;", "mx.box.test"]) {
      expect(verdictOf(mail({ verdict: [ar(v)] }))).toBe("unreadable");
    }
  });

  it("a header block cut short may hide an injected header: unreadable", () => {
    const padding = Array.from({ length: MAX_FIELDS }, (_, i) => `X-Pad-${i}: x`);
    expect(verdictOf(mail({ sender: [...padding, pass()] }))).toBe("unreadable");
  });

  it("a From that cannot be read, or two of them", () => {
    expect(verdictOf(mail({ from: `From: a@${CLIENT}, b@other.test` }))).toBe("failed");
    expect(verdictOf(mail({ sender: ["From: Mallory <m@attacker.test>"] }))).toBe("failed");
    expect(verdictOf(mail({ from: "" }))).toBe("failed");
  });

  it("never throws on hostile input", () => {
    const hostile = [
      "",
      ":",
      "\r\n\r\n",
      "Authentication-Results:",
      ar("(((("),
      ar(";".repeat(9000)),
    ];
    for (const raw of hostile) expect(() => verdictOf(raw)).not.toThrow();
  });
});
