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
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * The AUTHORITATIVE catalogue entry, printed after the platform packer's.
 *
 * The packer's own template is a generic one: it leaves `repo` and the package `url` as <FILL>,
 * and — the part that matters — it hardcodes `"minHost": "0.3.0"` for every node-runtime poppy.
 * That is the version the shared runtime landed in, not this poppy's requirement. Pasting it
 * would silently undo the 0.3.20 gate, and 0.3.20 is the first host whose maintenance session can
 * finish deleting this stack: on anything older, removing AuditPoppy from AgentsPoppy's own
 * screen strands the stack and leaves the bucket, table, role and function billing.
 *
 * A plausible default that quietly overrides a decision is the most expensive kind of trap, so
 * this prints the real thing rather than warning about the other one. `LISTING.minHost` is
 * test-pinned; this reads it rather than repeating it.
 */
// Read the three values out of the listing SOURCE rather than a build output: packages/core is
// bundled into the sidecar, so there is no dist to rely on here, and a silent fallback would put
// us back to the generic template this block exists to replace.
const listingSrc = readFileSync(join(repoRoot, "packages", "core", "src", "listing.ts"), "utf8");
const field = (key) => listingSrc.match(new RegExp(`^\\s*${key}: "([^"]+)"`, "m"))?.[1];
const manifest = JSON.parse(readFileSync(join(extensionDir, "extension.json"), "utf8"));
const LISTING = { name: field("name"), repo: field("repo"), minHost: field("minHost") };
const zip = join(extensionDir, "release", `${manifest.id}-${manifest.version}-any.zip`);
if (!LISTING.name || !LISTING.repo || !LISTING.minHost) {
  console.error("\npack: could not read name/repo/minHost from listing.ts — fix that before submitting.");
  process.exit(1);
}
if (existsSync(zip)) {
  const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
  const entry = {
    id: manifest.id,
    name: LISTING.name,
    version: manifest.version,
    repo: LISTING.repo,
    minHost: LISTING.minHost,
    packages: {
      any: {
        url: `${LISTING.repo}/releases/download/v${manifest.version}/${manifest.id}-${manifest.version}-any.zip`,
        sha256,
      },
    },
  };
  console.log("\nUse THIS entry, not the one above — the packer's template hardcodes minHost 0.3.0:");
  console.log(JSON.stringify(entry, null, 2));
  console.log(
    `\nIt assumes the zip is published as a GitHub Release asset on tag v${manifest.version}.` +
      " Publish it there first, then confirm the url resolves before submitting.",
  );
}
