/**
 * Builds a raw RFC 822 message from a fixture, to load the test mailbox.
 * Headers are ASCII (RFC 2047 encoded-words for UTF-8), the body is base64.
 */
import type { FixtureMessage } from "@cenacle/core";

function encodeWord(text: string): string {
  // Plain ASCII without specials can stay as is; anything else is encoded.
  const printableAscii = [...text].every((c) => c >= " " && c <= "~");
  if (printableAscii && !text.includes("=?")) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** A display name with RFC 5322 specials, e.g. "(fictive)", must be quoted or it reads as a comment. */
function displayName(name: string): string {
  const encoded = encodeWord(name);
  if (encoded !== name || !/[()<>[\]:;@\\,."]/.test(name)) return encoded;
  return `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

function wrap76(base64: string): string {
  return base64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`Header injection attempt in ${field}`);
}

export function toRfc822(message: FixtureMessage): Buffer {
  for (const [field, value] of [
    ["From name", message.from.name],
    ["From address", message.from.address],
    ["To", message.to],
    ["Subject", message.subject],
  ] as const) {
    assertHeaderSafe(value, field);
  }
  const headers = [
    `From: ${displayName(message.from.name)} <${message.from.address}>`,
    `To: <${message.to}>`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${new Date(message.date).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${message.id}@fixtures.cenacle.test>`,
    "MIME-Version: 1.0",
    `Content-Type: ${message.contentType}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap76(Buffer.from(message.body, "utf8").toString("base64"));
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`, "ascii");
}
