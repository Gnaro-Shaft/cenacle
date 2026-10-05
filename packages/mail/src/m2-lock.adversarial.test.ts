// The M2 lock: a real mailbox not marked `test = true` is sorted and followed,
// never drafted for nor sent from — decided by the cadre, checked again by
// each writer, before any connection is opened.
import { describe, expect, it } from "vitest";
import { parseCadre, ReadOnlyMailboxError, refuseReadOnly } from "./cadre.ts";
import { copyToSent, sendReply } from "./sender.ts";

const TODAY = "2026-10-04";
const CONSERVATION =
  "[conservation]\nmemoire_jours = 90\ntexte_brouillon_jours = 7\npropositions_jours = 90\njournal_jours = 180\n";
const mail = (host: string, address: string, extra = "") =>
  `[mail]\n${extra}source = "boite-pro"\nhost = "${host}"\nport = 993\nuser = "moi"\n` +
  `mailbox = "INBOX"\nsent_mailbox = "Sent"\nmax_per_fetch = 500\nsmtp_port = 465\naddress = "${address}"\n` +
  `authserv_id = "mx.box.test"\nrang_attendu = 5\n`;
const T01 =
  `[[traitement]]\nidentifiant = "T-01"\nfinalite = "Ranger la boîte pro."\n` +
  `base_legale = "interet-legitime"\ncategories = ["UID", "clés HMAC"]\n` +
  `sources = ["boite-pro"]\ntiers = true\nmention_publiee = 2026-10-04\n`;
const ENVOI = '[envoi]\ndestinataires = ["moi@entreprise.example"]\n';
const real = (extra = "") =>
  parseCadre(
    mail("ssl0.mail.example", "moi@entreprise.example", extra) + CONSERVATION + T01 + ENVOI,
    TODAY,
  );

describe("which mailbox is read-only", () => {
  it("a real box is read-only by default", () => {
    expect(real().mail.readOnly).toBe(true);
  });

  it("test = false written out changes nothing", () => {
    expect(real("test = false\n").mail.readOnly).toBe(true);
  });

  it("a real box marked test = true is not (M1: drafts and sending to my own addresses)", () => {
    expect(real("test = true\n").mail.readOnly).toBe(false);
  });

  it("the fictional box of this machine is not", () => {
    const fictional = parseCadre(
      mail("127.0.0.1", "test-cenacle@cenacle.test") + CONSERVATION,
      TODAY,
    );
    expect(fictional.mail.readOnly).toBe(false);
  });

  it.each([
    ["a string", 'test = "true"\n'],
    ["a number", "test = 1\n"],
  ])("a test mark written as %s is refused, not taken as true", (_label, extra) => {
    expect(() => real(extra)).toThrow(/mail\.test must be true or false/);
  });

  it("no key can lift the lock in M2", () => {
    expect(() => real("read_only = false\n")).toThrow(/unknown key "read_only"/);
    expect(() => real("brouillons = true\n")).toThrow(/unknown key "brouillons"/);
  });
});

describe("each writer refuses by itself", () => {
  it("refuseReadOnly: only an explicit false lets through", () => {
    expect(() => refuseReadOnly({ readOnly: true }, "x")).toThrow(ReadOnlyMailboxError);
    // A cadre built by hand without the field (a forged object) is refused too.
    expect(() => refuseReadOnly({} as { readOnly: boolean }, "x")).toThrow(ReadOnlyMailboxError);
    expect(() => refuseReadOnly({ readOnly: false }, "x")).not.toThrow();
  });

  it("no SMTP connection is even attempted", async () => {
    const cadre = { ...real().mail, host: "203.0.113.1", smtpPort: 1 };
    const reply = { to: "moi@entreprise.example", raw: Buffer.from("x") };
    await expect(sendReply(cadre, "pw", reply)).rejects.toThrow(ReadOnlyMailboxError);
  });

  it("no copy is written to Sent", async () => {
    const cadre = { ...real().mail, host: "203.0.113.1", port: 1 };
    await expect(copyToSent(cadre, "pw", Buffer.from("x"))).rejects.toThrow(ReadOnlyMailboxError);
  });
});
