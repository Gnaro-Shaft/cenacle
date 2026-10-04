// The reply always goes to the sender: a Reply-To elsewhere is reported and
// ignored; an unreadable or multiple sender leaves no target at all.
import { describe, expect, it } from "vitest";
import { splitHeaders } from "./postman.ts";
import { replyTargetOf, safeAddress, subjectOf } from "./reply-target.ts";
import { replySubject } from "./sender.ts";

describe("replyTargetOf", () => {
  it("answers the sender", () => {
    expect(replyTargetOf(1, [{ address: "claire@Client.Example" }], undefined)).toEqual({
      uid: 1,
      to: "claire@client.example",
      replyToElsewhere: false,
    });
  });

  it("a Reply-To to the same address is fine", () => {
    const t = replyTargetOf(
      1,
      [{ address: "claire@client.example" }],
      [{ address: "Claire@client.example" }],
    );
    expect(t.replyToElsewhere).toBe(false);
  });

  it("a Reply-To elsewhere is reported, never used", () => {
    const t = replyTargetOf(
      1,
      [{ address: "dg@client.example" }],
      [{ address: "paiements@autre-domaine.example" }],
    );
    expect(t).toEqual({ uid: 1, to: "dg@client.example", replyToElsewhere: true });
  });

  it.each([
    ["no sender", undefined],
    ["two senders", [{ address: "a@x.example" }, { address: "b@y.example" }]],
    ["no address", [{}]],
  ])("%s: no target", (_label, from) => {
    expect(replyTargetOf(1, from, undefined).to).toBeNull();
  });
});

describe("safeAddress", () => {
  it.each([
    "a@b",
    "a b@c.example",
    "a@c.example\r\nBcc: x@evil.example",
    "a@c.example,b@d.example",
    "<a@c.example>",
    "a@-.example\n",
    "a@-evil.example",
    "a@evil-.example",
    "a@evil..example",
    `${"a".repeat(65)}@c.example`,
    "",
  ])("refuses %j", (raw) => {
    expect(safeAddress(raw)).toBeNull();
  });

  it("keeps the local part, lower-cases the domain", () => {
    expect(safeAddress(" Jean.Dupont+cenacle@Client.EXAMPLE ")).toBe(
      "Jean.Dupont+cenacle@client.example",
    );
  });
});

// A raw 8-bit subject must not come back as mojibake in the reply ("Re: Point d'Ã©tape").
describe("subjectOf", () => {
  /** The raw header as the server sends it, read byte for byte like readReplyContexts does. */
  const raw = (header: Buffer) => splitHeaders(header.toString("latin1")).get("subject");
  const utf8 = (text: string) => Buffer.from(text, "utf8");
  const misread = (text: string) => utf8(text).toString("latin1");

  it("repairs a raw UTF-8 subject the envelope read as Latin-1", () => {
    const value = "Point d'étape — ça avance 👍";
    expect(subjectOf(raw(utf8(`Subject: ${value}\r\n`)), misread(value))).toBe(value);
  });

  it("keeps a real Latin-1 subject as the envelope read it", () => {
    const header = Buffer.from("Subject: Réunion à 14h\r\n", "latin1");
    expect(subjectOf(raw(header), "Réunion à 14h")).toBe("Réunion à 14h");
  });

  it("an ASCII or RFC 2047 subject is left to the envelope", () => {
    const header = utf8("Subject: =?UTF-8?Q?Point_d'=C3=A9tape?=\r\n");
    expect(subjectOf(raw(header), "Point d'étape")).toBe("Point d'étape");
  });

  it("decodes encoded words mixed with raw UTF-8", () => {
    const header = utf8("Subject: Ré: =?UTF-8?Q?donn=C3=A9es?=\r\n");
    expect(subjectOf(raw(header), "ignored")).toBe("Ré: données");
  });

  it("unfolds a subject written on several lines", () => {
    const header = utf8("Subject: Point d'étape\r\n  sur le dossier\r\n");
    expect(subjectOf(raw(header), "ignored")).toBe("Point d'étape sur le dossier");
  });

  it.each([
    ["truncated UTF-8 sequence", Buffer.from([...utf8("Subject: Point d"), 0xc3, 0x0d, 0x0a])],
    ["overlong encoding", Buffer.from([...utf8("Subject: x"), 0xc0, 0xaf, 0x0d, 0x0a])],
    ["doubled header", utf8("Subject: é\r\nSubject: è\r\n")],
    ["no header", utf8("References: <a@b.example>\r\n")],
  ])("%s: the envelope is kept, nothing throws", (_label, header) => {
    expect(subjectOf(raw(header), "enveloppe")).toBe("enveloppe");
  });

  it("no header and no envelope: empty, never undefined", () => {
    expect(subjectOf(undefined, undefined)).toBe("");
  });

  it("control characters smuggled in raw UTF-8 never reach the reply's subject", () => {
    // U+0085 (NEL) and U+2028 are line breaks for some readers; the raw header cannot hold CR/LF.
    const header = utf8("Subject: é\u0085Bcc: x@evil.example\u2028\u0007fin\r\n");
    const subject = replySubject(subjectOf(raw(header), "ignored"));
    expect(subject).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
    expect(subject.startsWith("Re: é")).toBe(true);
  });
});
