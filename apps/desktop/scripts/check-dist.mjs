#!/usr/bin/env node
/**
 * Post-build guard: the host serves the tab from /ext-ui/<id>/…, so every
 * asset reference in dist/index.html must be RELATIVE. A root-absolute
 * src/href loads an empty tab in AgentsPoppy (found live, 2026-09-03) —
 * fail the build the moment it reappears.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html"), "utf8");
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absolute.length > 0) {
  console.error(
    `check-dist: dist/index.html references root-absolute assets — the tab will be EMPTY inside AgentsPoppy:\n` +
      absolute.map((a) => `  ${a}`).join("\n") +
      `\nSet base: "./" in vite.config.ts.`,
  );
  process.exit(1);
}
console.log("check-dist: all asset references are relative ✓");
