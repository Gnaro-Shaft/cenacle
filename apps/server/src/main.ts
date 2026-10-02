/** Starts the API on 127.0.0.1 only. Usage: npm run server */

import { connectAsApp, createJournal } from "@cenacle/journal";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CENACLE_API_PORT ?? 8787);

const journal = createJournal(connectAsApp());
const app = createApp((agent, afterId) => journal.read({ agent, afterId, limit: 1000 }));

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Cénacle API listening on http://${HOST}:${info.port}`);
});
