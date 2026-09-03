/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The host serves the tab from /ext-ui/<id>/…, NOT the origin root — assets
  // must be referenced relative to index.html or the tab loads an empty page
  // (root-absolute /assets/… 404s against the broker).
  base: "./",
  build: { outDir: "dist", sourcemap: false },
  // The node-sidecar workspace lives under this directory but tests with
  // node:test — keep vitest to the frontend's own sources.
  test: { include: ["src/**/*.test.{ts,tsx}"] },
  server: {
    port: 5173,
    // Developer mode only: the tab talks to the sidecar through this proxy, so
    // no CORS surface exists. In the container the host proxies invokeBackend.
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
