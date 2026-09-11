#!/usr/bin/env node
/**
 * Print every value the developer dashboard's submission form asks for, in one place.
 *
 * Why a script and not a document: a written-out copy of the listing drifts from `listing.ts` the
 * first time a word changes there, and the form is the last place anyone would notice. This reads
 * the same objects the tests pin, the manifest, and the packed zip's real sha256 — so what it
 * prints is what is actually true at the moment you submit.
 *
 *   npm run submission
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(repoRoot, "apps", "desktop");
const manifest = JSON.parse(readFileSync(join(extensionDir, "extension.json"), "utf8"));
const src = readFileSync(join(repoRoot, "packages", "core", "src", "listing.ts"), "utf8");

/** Pull a quoted scalar out of the listing source — the objects are `as const`, so this is exact. */
const field = (key) => src.match(new RegExp(`^\\s*${key}: "((?:[^"\\\\]|\\\\.)*)"`, "m"))?.[1];
/** Pull a `key: [ ... ]` block and return its quoted strings in order. */
const list = (key) => {
  const block = src.match(new RegExp(`^\\s*${key}: \\[([\\s\\S]*?)^\\s*\\],`, "m"))?.[1] ?? "";
  return [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
};

const zip = join(extensionDir, "release", `${manifest.id}-${manifest.version}-any.zip`);
const sha256 = existsSync(zip) ? createHash("sha256").update(readFileSync(zip)).digest("hex") : null;

const rule = (t) => `\n${"─".repeat(78)}\n${t}\n${"─".repeat(78)}`;
console.log(rule("CATALOGUE ENTRY — paste as JSON"));
console.log(
  JSON.stringify(
    {
      id: manifest.id,
      name: field("name"),
      version: manifest.version,
      repo: field("repo"),
      minHost: field("minHost"),
      packages: {
        any: {
          url: `${field("repo")}/releases/download/v${manifest.version}/${manifest.id}-${manifest.version}-any.zip`,
          sha256: sha256 ?? "<run `npm run pack` first>",
        },
      },
    },
    null,
    2,
  ),
);
if (!sha256) {
  console.log("\n⚠️  No packed zip found — run `npm run pack` before submitting.");
} else {
  console.log(
    `\n⚠️  That sha256 is the zip in THIS working tree. The package is not byte-reproducible\n` +
      `   across machines — a Linux and a macOS build of the same commit differ in\n` +
      `   backend/index.cjs — so it is only the right value if this is the machine that\n` +
      `   published the release. Confirm against the published asset before submitting:\n\n` +
      `     gh release view v${manifest.version} --repo ${(field("repo") ?? "").replace("https://github.com/", "")} --json assets \\\n` +
      `       --jq '.assets[].digest'\n`,
  );
}

console.log(rule("LISTING FIELDS"));
console.log(`Name              ${field("name")}`);
console.log(`Tagline           ${field("tagline")}`);
console.log(`Publisher         ${field("publisher")}`);
console.log(`Website           ${field("website")}`);
console.log(`Category          ${field("categoryLabel")}`);
console.log(`Support           ${field("supportUrl")}`);
console.log(`Security contact  ${field("securityContact")}`);
console.log(`Platforms         any (macOS, Windows, Linux)`);
console.log(`Age rating        everyone`);
console.log(`Data stays in your cloud   YES  ← this is what renders the green panel`);

console.log(rule("DESCRIPTION — paste verbatim, it is test-pinned against the naming law"));
console.log(list("description").join("\n"));

console.log(rule("HIGHLIGHTS"));
for (const h of list("highlights")) console.log(`• ${h}`);

console.log(rule("FEATURES — the free/paid columns"));
const features = [...src.matchAll(/tier: "(free|paid)",\s*\n\s*title:\s*\n?\s*"((?:[^"\\]|\\.)*)",\s*\n\s*description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)];
for (const [, tier, title, desc] of features) {
  console.log(`\n[${tier.toUpperCase()}] ${JSON.parse(`"${title}"`)}`);
  console.log(`   ${JSON.parse(`"${desc}"`)}`);
}
if (features.length === 0) console.log("⚠️  No features parsed — read CATALOG.features in listing.ts directly.");

console.log(rule("CERTIFICATION"));
const cert = join(extensionDir, "leaves-no-trace.cert.json");
console.log(`Attach: ${cert}${existsSync(cert) ? "" : "   ⚠️  NOT FOUND — re-run certify"}`);
console.log("Notes: paste the 'Leaves-no-trace verification' paragraph from CLAUDE.md,");
console.log("       section 'THE CERTIFICATE OF RECORD'.");
console.log();
