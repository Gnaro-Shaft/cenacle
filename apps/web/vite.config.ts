import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pageSourcesHash, SOURCES_STAMP } from "@cenacle/core";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Once built, the fingerprint of the sources goes next to the page (ADR-0037). */
const stampSources = (): Plugin => ({
  name: "cenacle-sources-stamp",
  apply: "build",
  closeBundle() {
    const web = import.meta.dirname;
    writeFileSync(join(web, "dist", SOURCES_STAMP), `${pageSourcesHash(web)}\n`);
  },
});

// Built, the page is served by the API itself (ADR-0037). The dev server, on
// 127.0.0.1 only, stays for working on the page by hand: /api goes to the API.
export default defineConfig({
  plugins: [react(), stampSources()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
