/**
 * The sentinel (phase 5, S2 — ADR-0002), on a small VPS: it hears the Mac's
 * heartbeats and tells me on Telegram when they stop, and when they come
 * back. It sees no content and never talks to the Mac: the Mac talks to it.
 * Environment (/etc/cenacle-sentinel.env, readable by its user only):
 *   SENTINEL_LISTEN          the VPS's Tailscale address and port (host:port)
 *   SENTINEL_TOKEN           shared with the Mac (CENACLE_SENTINEL_TOKEN)
 *   SENTINEL_TELEGRAM_TOKEN  a bot of its own: the Mac's bot token never leaves the Mac
 *   SENTINEL_CHAT_ID         my chat only
 *   SENTINEL_SILENCE_MINUTES silence before the alert (default 10)
 *   SENTINEL_PROGRAMS        the programs that should run (default iris,executor; iris in M2)
 */
import { createServer } from "node:http";
import { createHandler } from "./server.ts";
import { createWatch, parsePrograms } from "./watch.ts";

function required(name: string): string {
  const value = process.env[name] ?? "";
  if (value === "") throw new Error(`${name} is missing`);
  return value;
}

const listen = required("SENTINEL_LISTEN");
const [host = "", portText = ""] = [
  listen.slice(0, listen.lastIndexOf(":")),
  listen.slice(listen.lastIndexOf(":") + 1),
];
const port = Number(portText);
if (host === "" || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SENTINEL_LISTEN must be host:port (the VPS's Tailscale address)");
}
if (host === "0.0.0.0" || host === "::")
  throw new Error("SENTINEL_LISTEN must not listen everywhere");
const token = required("SENTINEL_TOKEN");
if (token.length < 32) throw new Error("SENTINEL_TOKEN needs 32 characters at least");
const botToken = required("SENTINEL_TELEGRAM_TOKEN");
const chatId = required("SENTINEL_CHAT_ID");
const silenceMinutes = Number(process.env.SENTINEL_SILENCE_MINUTES ?? "10");
if (!Number.isInteger(silenceMinutes) || silenceMinutes < 2 || silenceMinutes > 120) {
  throw new Error("SENTINEL_SILENCE_MINUTES must be from 2 to 120");
}

const programs = parsePrograms(process.env.SENTINEL_PROGRAMS);
const watch = createWatch({ silenceMs: silenceMinutes * 60_000, startedAt: new Date(), programs });

async function tell(text: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

createServer(createHandler({ token, watch, now: () => new Date() })).listen(port, host, () => {
  console.log(
    `Sentinelle à l'écoute sur ${host}:${port} — alerte après ${silenceMinutes} min de silence de : ${programs.join(", ")}.`,
  );
});

setInterval(async () => {
  const message = watch.check(new Date());
  if (message === null) return;
  // Not told until delivered: Telegram down means trying again next round, said here.
  if (await tell(message)) watch.told();
  else console.error("⚠ Telegram injoignable : l'alerte sera renvoyée au prochain tour");
}, 30_000);
