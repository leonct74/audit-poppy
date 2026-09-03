#!/usr/bin/env node
/**
 * Install the built AuditPoppy into the LOCAL AgentsPoppy for testing:
 *
 *   npm run install:local        (builds first, then lays out the extension)
 *
 * Prefers the platform's own dev installer when the agentspoppy repo is
 * findable (env AGENTSPOPPY_REPO, then ~/Projects/agentspoppy, then
 * ../agentspoppy); otherwise lays out the documented extension structure
 * (AGENTS.md §2) itself — same result:
 *
 *   ~/.agentspoppy/extensions/com.auditpoppy.desktop/
 *     extension.json · frontend/… (the Vite dist) · backend/index.cjs
 *
 * Then RELAUNCH AgentsPoppy — the broker discovers extensions at startup.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, "apps", "desktop");
const frontendDist = join(srcDir, "dist");
const backendBundle = join(srcDir, "node-sidecar", "dist", "index.cjs");

for (const [what, path, fix] of [
  ["built frontend", frontendDist, "npm run build"],
  ["built backend", backendBundle, "npm run build"],
  ["manifest", join(srcDir, "extension.json"), "npm run gen:manifest"],
]) {
  if (!existsSync(path)) {
    console.error(`install:local: ${what} not found at ${path} — run \`${fix}\` first`);
    process.exit(1);
  }
}

const candidates = [
  process.env.AGENTSPOPPY_REPO,
  join(homedir(), "Projects", "agentspoppy"),
  resolve(repoRoot, "..", "agentspoppy"),
].filter(Boolean);
const platformInstaller = candidates
  .map((c) => join(c, "scripts", "install-dev-extension.mjs"))
  .find((p) => existsSync(p));

if (platformInstaller) {
  console.log(`using the platform installer: ${platformInstaller}`);
  execFileSync(
    process.execPath,
    [platformInstaller, "--src", srcDir, "--frontend", frontendDist, "--backend", backendBundle],
    { stdio: "inherit" },
  );
} else {
  // Fallback: the documented layout, laid out directly.
  const manifest = JSON.parse(readFileSync(join(srcDir, "extension.json"), "utf8"));
  const home = process.env.AGENTSPOPPY_HOME ?? join(homedir(), ".agentspoppy");
  const dest = join(home, "extensions", manifest.id);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(srcDir, "extension.json"), join(dest, "extension.json"));
  cpSync(frontendDist, join(dest, dirname(manifest.frontend.entry)), { recursive: true });
  const backendDest = join(dest, manifest.backend.entry);
  mkdirSync(dirname(backendDest), { recursive: true });
  copyFileSync(backendBundle, backendDest);
  chmodSync(backendDest, 0o755);
  console.log(`installed ${manifest.id} → ${dest}`);
}

console.log("\nNow RELAUNCH AgentsPoppy, open AuditPoppy in the sidebar, and approve the connection.");
console.log("Read the permission screen before approving — every wide read carries its reason.");
