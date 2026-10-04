// The register as the code reads it (ADR-0009, C1): a real mailbox is not read
// without an open processing, a processing without its published notice stops
// Cénacle, and the retentions cannot be missing, absurd or inconsistent.
import { describe, expect, it } from "vitest";
import { CadreError, parseCadre } from "./cadre.ts";

const TODAY = "2026-10-04";
const CONSERVATION =
  "[conservation]\nmemoire_jours = 90\ntexte_brouillon_jours = 7\npropositions_jours = 90\njournal_jours = 180\n";
const mail = (host: string, address: string) =>
  `[mail]\nsource = "boite-pro"\nhost = "${host}"\nport = 993\nuser = "moi"\nmailbox = "INBOX"\n` +
  `sent_mailbox = "Sent"\nmax_per_fetch = 500\nsmtp_port = 465\naddress = "${address}"\n`;
const FICTIONAL = mail("127.0.0.1", "test-cenacle@cenacle.test");
const T01 = (extra = "", mention = "mention_publiee = 2026-10-01") =>
  `[[traitement]]\nidentifiant = "T-01"\nfinalite = "Ranger la boîte pro."\n` +
  `base_legale = "interet-legitime"\ncategories = ["UID", "clés HMAC"]\n` +
  `sources = ["boite-pro"]\ntiers = true\n${mention}\n${extra}`;
const parse = (s: string) => parseCadre(s, TODAY);

describe("real mailboxes need an open processing", () => {
  it("the fictional mailbox of this machine needs none", () => {
    expect(parse(FICTIONAL + CONSERVATION).traitements).toEqual([]);
  });

  it.each([
    ["a remote server", mail("imap.mail.example", "moi@entreprise.example")],
    [
      "this machine, with a real address (a tunnel to a real box)",
      mail("127.0.0.1", "moi@exemple.fr"),
    ],
  ])("refuses %s without a processing", (_label, m) => {
    expect(() => parse(m + CONSERVATION)).toThrow(/no open processing covers it, it is not read/);
  });

  it("with a processing, a remote server still waits for TLS (M1)", () => {
    const m = mail("imap.mail.example", "moi@entreprise.example");
    expect(() => parse(m + CONSERVATION + T01())).toThrow(/needs TLS/);
  });

  it("a processing for another source does not cover this one", () => {
    const other = T01().replace('sources = ["boite-pro"]', 'sources = ["boite-perso"]');
    expect(() => parse(mail("127.0.0.1", "moi@exemple.fr") + CONSERVATION + other)).toThrow(
      /no open processing/,
    );
  });
});

describe("a processing is complete, or Cénacle does not start", () => {
  it("accepts a complete one and reads its notice date", () => {
    const [t] = parse(FICTIONAL + CONSERVATION + T01()).traitements;
    expect(t).toMatchObject({ identifiant: "T-01", tiers: true, mentionPubliee: "2026-10-01" });
  });

  it.each([
    ["no notice date", T01("", "")],
    ["a notice dated tomorrow (not published yet)", T01("", "mention_publiee = 2026-10-05")],
    ["a notice date that is not a date", T01("", 'mention_publiee = "bientôt"')],
    ["an unknown legal basis", T01().replace('"interet-legitime"', '"parce-que"')],
    ["no categories", T01().replace('categories = ["UID", "clés HMAC"]', "categories = []")],
    ["a malformed source", T01().replace('["boite-pro"]', '["Boîte Pro!"]')],
    ["tiers as text", T01().replace("tiers = true", 'tiers = "oui"')],
    ["a malformed identifier", T01().replace('"T-01"', '"T1"')],
    ["an unknown key (a typo)", T01("retention = 30\n")],
    ["an empty purpose", T01().replace('"Ranger la boîte pro."', '"  "')],
  ])("refuses %s", (_label, t) => {
    expect(() => parse(FICTIONAL + CONSERVATION + t)).toThrow(CadreError);
  });

  it("refuses the same identifier twice, and a source claimed by two processings", () => {
    const twice = T01() + T01().replace('["boite-pro"]', '["boite-perso"]');
    expect(() => parse(FICTIONAL + CONSERVATION + twice)).toThrow(/declared twice/);
    const claimed = T01() + T01().replace('"T-01"', '"T-02"');
    expect(() => parse(FICTIONAL + CONSERVATION + claimed)).toThrow(/claimed by T-01 and T-02/);
  });
});

describe("retentions", () => {
  const with_ = (memoire: number, texte: number, propositions: number, journal: number) =>
    `${FICTIONAL}[conservation]\nmemoire_jours = ${memoire}\ntexte_brouillon_jours = ${texte}\n` +
    `propositions_jours = ${propositions}\njournal_jours = ${journal}\n`;

  it.each([
    ["missing", FICTIONAL],
    ["zero days", with_(0, 7, 90, 180)],
    ["a draft text kept for months", with_(90, 120, 90, 180)],
    ["a journal shorter than the mail memory (the bubble would go wrong)", with_(90, 7, 90, 90)],
    ["a negative value", with_(90, -1, 90, 180)],
    ["a fraction", with_(90.5, 7, 90, 180)],
  ])("refuses %s", (_label, s) => {
    expect(() => parse(s)).toThrow(CadreError);
  });

  it("refuses an unknown retention key", () => {
    expect(() => parse(`${FICTIONAL}${CONSERVATION}brouillons_jours = 7\n`)).toThrow(/unknown key/);
  });
});
