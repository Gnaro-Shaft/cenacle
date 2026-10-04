// M1: a real server is reached over TLS with its certificate checked, always;
// a server presenting a certificate we cannot trust is refused, not used.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:tls";
import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imapOptions, smtpOptions } from "./connection.ts";

describe("connection options", () => {
  it("the local test server: plain, no TLS attempted", () => {
    const imap = imapOptions({ host: "127.0.0.1", port: 3143, user: "t" }, "p");
    expect(imap.secure).toBe(false);
    expect(imap.tls).toBeUndefined();
    expect(smtpOptions({ host: "127.0.0.1", smtpPort: 3025, user: "t" }, "p")).toMatchObject({
      secure: false,
      ignoreTLS: true,
    });
  });

  it("a real server: implicit TLS, checked certificate, its own name, TLS 1.2 at least", () => {
    const imap = imapOptions({ host: "mail.example", port: 993, user: "t" }, "p");
    expect(imap.secure).toBe(true);
    expect(imap.tls).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: "mail.example",
    });
    expect(smtpOptions({ host: "mail.example", smtpPort: 465, user: "t" }, "p")).toMatchObject({
      secure: true,
      tls: { rejectUnauthorized: true },
    });
  });

  it("a real server on a STARTTLS port: TLS is required, never optional", () => {
    expect(smtpOptions({ host: "mail.example", smtpPort: 587, user: "t" }, "p")).toMatchObject({
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
    });
  });
});

describe("a certificate we cannot trust is refused", () => {
  let server: Server;
  let port = 0;
  const dir = mkdtempSync(join(tmpdir(), "cenacle-tls-"));
  beforeAll(async () => {
    // A self-signed certificate for another name: what a man in the middle would present.
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=imposteur.example",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    server = createServer(
      { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
      (socket) => socket.end("* OK fake IMAP\r\n"),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the IMAP connection to it fails before any login", async () => {
    // The options of a real server, pointed at the impostor.
    const options = {
      ...imapOptions({ host: "mail.example", port, user: "u" }, "secret"),
      host: "127.0.0.1",
    };
    const client = new ImapFlow(options);
    client.on("error", () => {});
    await expect(client.connect()).rejects.toThrow(/certificate|self.signed|altnames|SSL|TLS/i);
  });
});
