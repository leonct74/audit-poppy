#!/usr/bin/env node
/**
 * Run the platform's leaves-no-trace certification against THIS poppy.
 *
 *   npm run certify -- --yes
 *
 * The harness lives in the agentspoppy repo, not here (AGENTS.md "Prove it"), and it is the
 * same one the platform re-runs and signs at submission. This wrapper exists so nobody has to
 * remember where that repo is or which path to pass — the founder ran `npm run certify` in this
 * repo on 2026-09-07 and got "Missing script", because there wasn't one.
 *
 * It passes `--extension` itself, which is why AGENTS.md tells you NOT to pass another: a second
 * one wins and resolves against the agentspoppy directory instead.
 *
 * ORDER MATTERS, and it is the opposite of the intuitive one: certify performs the teardown
 * ITSELF, so it needs a poppy that is currently deployed and used. Tearing down first leaves it
 * nothing to sweep. Certify first, then rebuild for real.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(repoRoot, "apps", "desktop");

if (!existsSync(join(extensionDir, "extension.json"))) {
  console.error("certify: no extension.json — run `npm run build` first.");
  process.exit(1);
}

const candidates = [
  process.env.AGENTSPOPPY_REPO,
  join(homedir(), "Projects", "agentspoppy"),
  resolve(repoRoot, "..", "agentspoppy"),
].filter(Boolean);
const platform = candidates.find((c) => existsSync(join(c, "scripts", "certify.ts")));

if (!platform) {
  console.error(
    [
      "certify: couldn't find the agentspoppy repo, which is where the harness lives.",
      "Looked in:",
      ...candidates.map((c) => `  ${c}`),
      "",
      "Set AGENTSPOPPY_REPO to its path and try again.",
    ].join("\n"),
  );
  process.exit(1);
}

const passthrough = process.argv.slice(2);
if (!passthrough.includes("--yes")) {
  console.error(
    [
      "certify: this performs a REAL teardown in the connected cloud account — it will disable",
      "the services AuditPoppy enabled, delete its stack and empty its evidence bucket.",
      "",
      "It also needs the poppy currently DEPLOYED AND USED: it tears down itself, then sweeps",
      "for anything left tagged. If you have already torn down, there is nothing to certify —",
      "start the audit again first.",
      "",
      "Re-run with:  npm run certify -- --yes",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`certifying ${extensionDir}\n  using the harness in ${platform}`);
execFileSync("npm", ["run", "certify", "--", "--extension", extensionDir, ...passthrough], {
  cwd: platform,
  stdio: "inherit",
});
