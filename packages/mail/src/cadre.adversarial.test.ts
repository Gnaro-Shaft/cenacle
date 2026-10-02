// A typo or a hostile edit of cadre.toml must stop Cénacle, never be ignored.
import { describe, expect, it } from "vitest";
import { CadreError, parseCadre } from "./cadre.ts";

const valid = {
  host: '"127.0.0.1"',
  port: "3143",
  user: '"test-cenacle"',
  mailbox: '"INBOX"',
  sent_mailbox: '"Sent"',
  max_per_fetch: "500",
};
const toml = (mail: Record<string, string>, extra = "") =>
  `${extra}[mail]\n${Object.entries(mail)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n")}\n`;

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
  ])("refuses %s", (_label, mail) => {
    expect(() => parseCadre(toml(mail))).toThrow(CadreError);
  });

  it("refuses a missing key", () => {
    const { mailbox: _dropped, ...rest } = valid;
    expect(() => parseCadre(toml(rest))).toThrow(CadreError);
  });

  it("refuses an unknown section", () => {
    expect(() => parseCadre(toml(valid, "[smtp]\nhost = 'x'\n"))).toThrow(/unknown key "smtp"/);
  });

  it("refuses invalid TOML", () => {
    expect(() => parseCadre("[mail\nhost=")).toThrow(/invalid TOML/);
  });
});
