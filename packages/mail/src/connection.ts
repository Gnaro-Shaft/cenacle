/**
 * How Cénacle connects to a mail server (phase 5, M1) — one place for the
 * four uses (collection, reading, reply targets, sending and its copy), so
 * that none can drift.
 *
 * - The fictional test server on this machine (GreenMail): plain, loopback only.
 * - Any other server: TLS, always, with the certificate checked against the
 *   server's name and TLS 1.2 at least. There is no switch to turn it off.
 */
import type { ImapFlowOptions } from "imapflow";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);
export const isLoopback = (host: string): boolean => LOOPBACK.has(host);

/** Checked certificate, matching name, no old protocol. */
const tlsFor = (host: string) =>
  ({ rejectUnauthorized: true, minVersion: "TLSv1.2", servername: host }) as const;

export function imapOptions(
  server: { readonly host: string; readonly port: number; readonly user: string },
  password: string,
): ImapFlowOptions {
  const local = isLoopback(server.host);
  return {
    host: server.host,
    port: server.port,
    // Implicit TLS (IMAPS, port 993) for every server but the local test one.
    secure: !local,
    ...(local ? {} : { tls: tlsFor(server.host) }),
    auth: { user: server.user, pass: password },
    logger: false,
  };
}

export function smtpOptions(
  server: { readonly host: string; readonly smtpPort: number; readonly user: string },
  password: string,
): SMTPTransport.Options {
  const local = isLoopback(server.host);
  const implicitTls = !local && server.smtpPort === 465;
  return {
    host: server.host,
    port: server.smtpPort,
    // 465: TLS from the first byte. Any other port on a real server: STARTTLS, required.
    secure: implicitTls,
    // The local test server offers no TLS: never attempted there.
    ...(local ? { ignoreTLS: true } : { requireTLS: !implicitTls, tls: tlsFor(server.host) }),
    auth: { user: server.user, pass: password },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  };
}
