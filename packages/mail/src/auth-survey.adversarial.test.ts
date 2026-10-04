// The survey must tell our server's headers from the ones a sender writes,
// and print nothing that names anyone — not even a server.
import { describe, expect, it } from "vitest";
import { authShape, summarize } from "./auth-survey.ts";
import { MAX_FIELDS, orderedHeaders } from "./ordered-headers.ts";

const OURS = "mx.box.test";
const CLIENT = "client.example";

/** A mail as it lands: our server's headers on top, the sender's below. */
function mail(top: string[], sender: string[] = [], from = `From: Alice <alice@${CLIENT}>`) {
  return [
    ...top,
    "Received: from relay.attacker.test by mx.box.test",
    ...sender,
    from,
    "Subject: urgent",
  ].join("\r\n");
}
const shapeOf = (raw: string) => {
  const { fields, truncated } = orderedHeaders(raw);
  return authShape(fields, truncated);
};
const ar = (value: string) => `Authentication-Results: ${value}`;

describe("orderedHeaders", () => {
  it("keeps duplicates in order and unfolds continuations", () => {
    const { fields } = orderedHeaders(
      "Received: a\r\n  b\r\nAuthentication-Results: one\r\nReceived: c\r\n",
    );
    expect(fields).toEqual([
      { name: "received", value: "a b" },
      { name: "authentication-results", value: "one" },
      { name: "received", value: "c" },
    ]);
  });

  it("drops a leading continuation and invalid names, and says when it stopped", () => {
    expect(orderedHeaders(" orphan\r\nBad Name: x\r\nFrom: a").fields).toEqual([
      { name: "from", value: "a" },
    ]);
    const lines = Array.from({ length: MAX_FIELDS + 5 }, () => "Received: x");
    const many = orderedHeaders(lines.join("\n"));
    expect(many.fields).toHaveLength(MAX_FIELDS);
    expect(many.truncated).toBe(true);
  });
});

describe("authShape — where a header sits is the evidence", () => {
  it("our header above every Received: position 0, aligned pass", () => {
    const shape = shapeOf(mail([ar(`${OURS}; dmarc=pass header.from=${CLIENT}`)]));
    expect(shape.authResults).toEqual([
      expect.objectContaining({ server: OURS, receivedAbove: 0 }),
    ]);
    expect(shape.authResults[0]?.methods.dmarc).toEqual({ outcome: "pass", aligned: true });
  });

  it("a header injected by the sender, even claiming to be ours, sits below a Received", () => {
    const shape = shapeOf(
      mail(
        [ar(`${OURS}; dmarc=fail header.from=${CLIENT}`)],
        [ar(`${OURS}; dmarc=pass header.from=${CLIENT}`)],
      ),
    );
    expect(shape.authResults.map((h) => h.receivedAbove)).toEqual([0, 1]);
    expect(shape.authResults.map((h) => h.methods.dmarc.outcome)).toEqual(["fail", "pass"]);
  });

  it("a pass for another domain is not aligned (forged From)", () => {
    const shape = shapeOf(mail([ar(`${OURS}; dkim=pass header.d=attacker.test; dmarc=none`)]));
    expect(shape.authResults[0]?.methods.dkim).toEqual({ outcome: "pass", aligned: false });
    expect(shape.authResults[0]?.methods.dmarc).toEqual({ outcome: "none", aligned: false });
  });

  it("a parent or child domain is not aligned either", () => {
    for (const d of ["example", `mail.${CLIENT}`]) {
      const shape = shapeOf(mail([ar(`${OURS}; dkim=pass header.d=${d}`)]));
      expect(shape.authResults[0]?.methods.dkim.aligned).toBe(false);
    }
  });

  it("no alignment at all when the From cannot be read, or is there twice", () => {
    const pass = ar(`${OURS}; dmarc=pass header.from=${CLIENT}`);
    const twice = shapeOf(mail([pass], [`From: b@${CLIENT}`]));
    expect(twice.fromReadable).toBe(false);
    expect(twice.authResults[0]?.methods.dmarc.aligned).toBe(false);
    const group = shapeOf(mail([pass], [], `From: team: a@${CLIENT};`));
    expect(group.authResults[0]?.methods.dmarc.aligned).toBe(false);
  });

  it("an unreadable header counts as a header from nobody", () => {
    const shape = shapeOf(mail([ar("(((dmarc=pass")]));
    expect(shape.authResults[0]?.server).toBeNull();
    expect(shape.authResults[0]?.methods.dmarc.outcome).toBe("absent");
  });

  it("an unknown result word is `other`, never a pass", () => {
    const shape = shapeOf(mail([ar(`${OURS}; dmarc=bestfail header.from=${CLIENT}`)]));
    expect(shape.authResults[0]?.methods.dmarc).toEqual({ outcome: "other", aligned: false });
  });

  it("no header at all; ARC and Received-SPF are counted apart, never as ours", () => {
    const shape = shapeOf(
      mail(["ARC-Authentication-Results: i=1; other.test; dmarc=pass", "Received-SPF: pass"]),
    );
    expect(shape.authResults).toEqual([]);
    expect(shape.arc).toBe(true);
    expect(shape.receivedSpf).toBe(true);
  });
});

describe("summarize — counts only", () => {
  const shapes = [
    shapeOf(mail([ar(`${OURS}; dmarc=pass header.from=${CLIENT}`)])),
    shapeOf(
      mail(
        [ar(`${OURS}; dmarc=fail header.from=${CLIENT}`)],
        [ar(`${OURS}; dmarc=pass header.from=${CLIENT}`)],
      ),
    ),
    shapeOf(mail([], [ar("secret-name.attacker.test; dmarc=pass")])),
    shapeOf(mail([])),
  ];

  it("ranks servers, tells which one was given, and counts positions", () => {
    const s = summarize(shapes, " MX.BOX.TEST ");
    expect(s.mails).toBe(4);
    expect(s.withAuthResults).toBe(3);
    expect(s.givenSeen).toBe(true);
    const [a, b] = s.servers;
    expect(a).toMatchObject({ label: "A", mails: 2, topmost: 2, repeated: 1, matchesGiven: true });
    expect(a?.positions).toEqual({ 0: 2, 1: 1 });
    // The topmost header of each mail is counted, not the injected one below.
    expect(a?.outcomes.dmarc.pass).toBe(1);
    expect(a?.outcomes.dmarc.fail).toBe(1);
    expect(b).toMatchObject({ label: "B", mails: 1, topmost: 1, matchesGiven: false });
    expect(b?.positions).toEqual({ 1: 1 });
  });

  it("never carries a server name, a domain or an address", () => {
    const text = JSON.stringify(summarize(shapes, OURS));
    for (const secret of [OURS, "box", "secret-name", "attacker", CLIENT, "alice", "urgent"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a server not given is said absent; none given says nothing", () => {
    expect(summarize(shapes, "other.test").givenSeen).toBe(false);
    expect(summarize(shapes).givenSeen).toBeNull();
    expect(summarize(shapes).servers[0]?.matchesGiven).toBeNull();
  });

  it("lists at most 6 servers, and counts the mails of the others", () => {
    const many = Array.from({ length: 9 }, (_, i) => shapeOf(mail([ar(`s${i}.test; none`)])));
    const s = summarize(many);
    expect(s.servers).toHaveLength(6);
    expect(s.otherServerMails).toBe(3);
  });

  it("an empty mailbox gives zeros, not an error", () => {
    expect(summarize([])).toMatchObject({ mails: 0, withAuthResults: 0, servers: [] });
  });
});
