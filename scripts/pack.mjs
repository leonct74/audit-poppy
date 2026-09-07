#!/usr/bin/env node
/**
 * Pack this poppy with the DIRECTORY'S packer, and pass it the three paths it cannot guess.
 *
 *   npm run pack
 *
 * Why this exists, and it is the same reason `certify` does: the release runbook says "pack with
 * the directory's packer — never zip/ditto", and running that command by hand goes wrong twice.
 *
 *   1. The packer defaults `--backend` to `<src>/<manifest backend entry>`, i.e.
 *      apps/desktop/backend/index.cjs. Our build writes the bundle to
 *      apps/desktop/node-sidecar/dist/index.cjs, because that is where the sidecar workspace
 *      builds — so a bare `pack-extension.mjs --src apps/desktop` dies with "built backend not
 *      found". install-local.mjs already knew the real path; the pack path did not.
 *   2. The harness lives in the agentspoppy repo, not here, exactly as certify's does.
 *
 * The output is a deterministic STORE (uncompressed) zip — the sha256 IS the trust story, so it
 * must be reproducible — plus the catalog entry to submit. A compressed zip is rejected by the
 * installer, which is why this never falls back to `zip`.
 *
 * `prepack` builds first: packing a stale bundle produces a package whose sha does not match the
 * code you think you shipped, and nothing downstream would notice.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(repoRoot, "apps", "desktop");
const frontendDist = join(extensionDir, "dist");
const backendBundle = join(extensionDir, "node-sidecar", "dist", "index.cjs");

for (const [what, path] of [
  ["extension.json", join(extensionDir, "extension.json")],
  ["built frontend", frontendDist],
  ["built backend", backendBundle],
]) {
  if (!existsSync(path)) {
    console.error(`pack: no ${what} at ${path} — run \`npm run build\` first.`);
    process.exit(1);
  }
}

const candidates = [
  process.env.AGENTSPOPPY_REPO,
  join(homedir(), "Projects", "agentspoppy"),
  resolve(repoRoot, "..", "agentspoppy"),
].filter(Boolean);
const platform = candidates.find((c) => existsSync(join(c, "scripts", "pack-extension.mjs")));

if (!platform) {
  console.error(
    [
      "pack: couldn't find the agentspoppy repo, which is where the packer lives.",
      "Looked in:",
      ...candidates.map((c) => `  ${c}`),
      "",
      "Set AGENTSPOPPY_REPO to its path and try again.",
    ].join("\n"),
  );
  process.exit(1);
}

execFileSync(
  "node",
  [
    join(platform, "scripts", "pack-extension.mjs"),
    "--src", extensionDir,
    "--frontend", frontendDist,
    "--backend", backendBundle,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
