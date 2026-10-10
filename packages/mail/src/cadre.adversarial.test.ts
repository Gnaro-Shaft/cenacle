// A typo or a hostile edit of cadre.toml must stop Cénacle, never be ignored.
import { describe, expect, it } from "vitest";
import { CadreError, parseCadre } from "./cadre.ts";

const valid = {
  source: '"boite-test"',
  host: '"127.0.0.1"',
  port: "3143",
  user: '"test-cenacle"',
  mailbox: '"INBOX"',
  sent_mailbox: '"Sent"',
  max_per_fetch: "500",
  smtp_port: "3025",
  address: '"test-cenacle@cenacle.test"',
  authserv_id: '"mx.cenacle.test"',
  rang_attendu: "0",
};
const CONSERVATION =
  "[conservation]\nmemoire_jours = 90\ntexte_brouillon_jours = 7\npropositions_jours = 90\njournal_jours = 180\nopposition_jours = 1095\n";
const toml = (mail: Record<string, string>, extra = "") =>
  `${extra}[mail]\n${Object.entries(mail)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n")}\n${CONSERVATION}`;

describe("cadre.toml — refused", () => {
  it("accepts the reference values", () => {
    expect(() => parseCadre(toml(valid))).not.toThrow();
  });

  it.each([
    ["a remote host", { ...valid, host: '"imap.gmail.com"' }],
    ["a LAN address", { ...valid, host: '"192.168.1.10"' }],
    ["a Tailscale address", { ...valid, host: '"100.64.0.1"' }],
    ["a string port", { ...valid, port: '"3143"' }],
    ["port 0", { ...valid, port: "0" }],
    ["a float ceiling", { ...valid, max_per_fetch: "500.5" }],
    ["a zero ceiling", { ...valid, max_per_fetch: "0" }],
    ["a huge ceiling", { ...valid, max_per_fetch: "1000000" }],
    ["a negative ceiling", { ...valid, max_per_fetch: "-1" }],
    ["an IMAP-injecting mailbox", { ...valid, mailbox: '"INBOX\\r\\nA1 DELETE INBOX"' }],
    ["a typo'd key", { ...valid, max_per_fecth: "500" }],
    ["a password in the file", { ...valid, password: '"hunter2"' }],
    ["a real sender address", { ...valid, address: '"moi@exemple.fr"' }],
    ["a header-injecting address", { ...valid, address: '"a@b.test\\r\\nBcc: x@evil.com"' }],
    ["no SMTP port", { ...valid, smtp_port: "0" }],
    // ADR-0014: the server whose Authentication-Results is believed.
    ["an empty server name", { ...valid, authserv_id: '""' }],
    ["a server name with a space", { ...valid, authserv_id: '"mx.box.test evil"' }],
    ["a server name with a ;", { ...valid, authserv_id: '"mx.box.test;"' }],
    ["a server name as a placeholder", { ...valid, authserv_id: '"<first word>"' }],
    ["a numeric server name", { ...valid, authserv_id: "12" }],
    ["a negative rank", { ...valid, rang_attendu: "-1" }],
    ["a float rank", { ...valid, rang_attendu: "1.5" }],
    ["a huge rank", { ...valid, rang_attendu: "51" }],
    ["a string rank", { ...valid, rang_attendu: '"5"' }],
  ])("refuses %s", (_label, mail) => {
    expect(() => parseCadre(toml(mail))).toThrow(CadreError);
  });

  it("refuses a missing key", () => {
    const { mailbox: _dropped, ...rest } = valid;
    expect(() => parseCadre(toml(rest))).toThrow(CadreError);
  });

  it("refuses a mailbox without its trusted server: no silent default (ADR-0014)", () => {
    const { authserv_id: _id, ...noServer } = valid;
    expect(() => parseCadre(toml(noServer))).toThrow(/authserv_id/);
    const { rang_attendu: _rank, ...noRank } = valid;
    expect(() => parseCadre(toml(noRank))).toThrow(/rang_attendu/);
  });

  it("reads the server name lowercased", () => {
    const cadre = parseCadre(toml({ ...valid, authserv_id: '"MX.Cenacle.TEST"' }));
    expect(cadre.mail.trustedServer).toEqual({ authservId: "mx.cenacle.test", receivedAbove: 0 });
  });

  it("refuses an unknown section", () => {
    expect(() => parseCadre(toml(valid, "[smtp]\nhost = 'x'\n"))).toThrow(/unknown key "smtp"/);
  });

  it("refuses invalid TOML", () => {
    expect(() => parseCadre("[mail\nhost=")).toThrow(/invalid TOML/);
  });
});
