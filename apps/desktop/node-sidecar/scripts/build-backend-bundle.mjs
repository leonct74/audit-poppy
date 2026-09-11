#!/usr/bin/env node
/**
 * Bundle the sidecar into the single CJS file the manifest names
 * (backend/index.cjs, runtime node22 — docs/RUNTIMES.md: poppies ship no
 * runtime bytes; the host runs the bundle on its own confined Node).
 */
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidecarRoot = resolve(here, "..");
const outDir = join(sidecarRoot, "dist");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(sidecarRoot, "src", "index.ts")],
  outfile: join(outDir, "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  legalComments: "none",
  logLevel: "info",
});
console.log(`✅ backend bundle → ${join(outDir, "index.cjs")}`);
