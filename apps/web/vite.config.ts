import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server on 127.0.0.1 only; /api is forwarded to the local API.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
