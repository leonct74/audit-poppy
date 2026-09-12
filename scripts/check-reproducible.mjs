#!/usr/bin/env node
/**
 * Prove the shipped package is a pure function of the source.
 *
 *   npm run check:reproducible
 *
 * WHY THIS SHAPE, and not the obvious one. The v0.1.0 determinism bug was a timestamp inside the
 * base64-inlined Lambda zip, taken from `git log -1 --format=%ct` — HEAD's committer date. The
 * obvious check (build twice on one machine, same minute, compare) passed the whole time the bug
 * was live, because HEAD did not move between the two builds. Touching the Lambda sources would
 * not have caught it either: a source mtime is not HEAD's commit date.
 *
 * So this perturbs every input that ISN'T the source, together, and demands the bytes not move:
 *
 *   1. git's reported commit date — via a PATH shim, so we simulate landing a new commit without
 *      writing one. This is the input that actually broke, and the only one of the four that the
 *      pre-fix build consulted.
 *   2. source mtimes — every Lambda and sidecar source touched.
 *   3. the wall clock — it has moved between the two builds by construction.
 *   4. TZ — a zip's DOS timestamp is local-time-shaped, so a UTC slip shows up here.
 *
 * SOURCE_DATE_EPOCH is deliberately NOT perturbed: it is a declared input at both zip layers, so
 * changing it is *supposed* to change the bytes. Instead we assert the release configuration —
 * SOURCE_DATE_EPOCH unset — stamps the fixed 1980-01-01 floor.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarDist = join(repoRoot, "apps", "desktop", "node-sidecar", "dist", "index.cjs");
const releaseDir = join(repoRoot, "apps", "desktop", "release");

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fail = (msg) => {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
};

// The packer lives in the agentspoppy repo (same lookup pack.mjs does). Without it we can still
// check the backend bundle, which is where the embedded Lambda zip — and the bug — lives.
const packer = [process.env.AGENTSPOPPY_REPO, join(homedir(), "Projects", "agentspoppy"), resolve(repoRoot, "..", "agentspoppy")]
  .filter(Boolean)
  .find((c) => existsSync(join(c, "scripts", "pack-extension.mjs")));
const target = packer ? "pack" : "build";
if (!packer) {
  console.log("ℹ️  agentspoppy packer not found — checking the backend bundle only, not the package zip.");
}

/** Everything the build reads as source. Touching these must not move the output. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === "node_modules" || d.name === "dist" || d.name === "generated") continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(ts|mjs|js|json)$/.test(d.name)) out.push(p);
    }
  };
  walk(join(repoRoot, "lambdas", "src"));
  walk(join(repoRoot, "apps", "desktop", "node-sidecar", "src"));
  walk(join(repoRoot, "packages", "core", "src"));
  return out;
}

/** A `git` that reports a different HEAD commit date, and forwards everything else to the real one. */
function gitShimDir(fakeEpoch) {
  const dir = mkdtempSync(join(tmpdir(), "auditpoppy-gitshim-"));
  const real = execFileSync("bash", ["-lc", "command -v git"]).toString().trim();
  const shim = join(dir, "git");
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      "# Determinism check: any build that asks git what time HEAD was committed gets a lie.",
      `for a in "$@"; do case "$a" in *%ct*|*%cd*|*%ci*|*%at*|*%ad*|*%aI*|*%cI*) echo "${fakeEpoch}"; exit 0;; esac; done`,
      `exec ${JSON.stringify(real)} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(shim, 0o755);
  return dir;
}

function build(label, env) {
  process.stdout.write(`   building (${label}) … `);
  try {
    execFileSync("npm", ["run", target], { cwd: repoRoot, env, stdio: "pipe" });
  } catch (e) {
    console.error("\n" + (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""));
    fail(`the ${label} build failed.`);
  }
  const zip = packer ? readdirSync(releaseDir).find((f) => f.endsWith(".zip")) : null;
  const out = { backend: sha256(sidecarDist), pkg: zip ? sha256(join(releaseDir, zip)) : null, zipName: zip };
  console.log(`backend ${out.backend.slice(0, 12)}…${out.pkg ? `  package ${out.pkg.slice(0, 12)}…` : ""}`);
  return out;
}

/** Decode the DOS mtime of the Lambda zip embedded in the built backend bundle. */
function embeddedStamp() {
  const src = readFileSync(sidecarDist, "utf8");
  const m = src.match(/"(UEsDB[A-Za-z0-9+/=]{200,})"/);
  if (!m) fail("could not find the embedded Lambda zip in the backend bundle.");
  const z = Buffer.from(m[1], "base64");
  const t = z.readUInt16LE(10);
  const d = z.readUInt16LE(12);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    text: `${((d >> 9) & 0x7f) + 1980}-${pad((d >> 5) & 0xf)}-${pad(d & 0x1f)} ${pad((t >> 11) & 0x1f)}:${pad((t >> 5) & 0x3f)}:${pad((t & 0x1f) * 2)}`,
    crc: z.readUInt32LE(14).toString(16).padStart(8, "0"),
  };
}

// Leave the tree as we found it: apps/desktop/release/* is committed, and this rebuilds it.
const saved = existsSync(releaseDir) ? readdirSync(releaseDir).map((f) => [join(releaseDir, f), join(mkdtempSync(join(tmpdir(), "auditpoppy-rel-")), f)]) : [];
for (const [from, to] of saved) copyFileSync(from, to);
const restore = () => {
  for (const [from, to] of saved) if (existsSync(to)) copyFileSync(to, from);
};
process.on("exit", restore);

console.log("Reproducibility check — the same source must produce the same bytes.\n");

const baseEnv = { ...process.env };
delete baseEnv.SOURCE_DATE_EPOCH;
const first = build("baseline", baseEnv);

const stamp = embeddedStamp();
if (stamp.text !== "1980-01-01 00:00:00") {
  fail(
    `the embedded Lambda zip is stamped ${stamp.text}, not the fixed 1980-01-01 00:00:00.\n` +
      `   With SOURCE_DATE_EPOCH unset the stamp must be the floor. A real date here means the\n` +
      `   build is reading a clock or a commit date again — see scripts/build-lambda-bundle.mjs.`,
  );
}
console.log(`   embedded Lambda zip: stamped ${stamp.text}, CRC-32 ${stamp.crc} ✓`);

console.log("\n   perturbing: git commit date, source mtimes, wall clock, TZ");
const touched = sourceFiles();
const now = new Date();
for (const f of touched) utimesSync(f, now, now);
const shim = gitShimDir(1234567890);
console.log(`   touched ${touched.length} source files; git shim reports commit date 1234567890`);

const second = build("perturbed", { ...baseEnv, PATH: `${shim}:${baseEnv.PATH}`, TZ: "Pacific/Kiritimati" });
rmSync(shim, { recursive: true, force: true });

const diffs = [];
if (first.backend !== second.backend) diffs.push(["backend bundle", first.backend, second.backend]);
if (first.pkg && first.pkg !== second.pkg) diffs.push(["package zip", first.pkg, second.pkg]);

if (diffs.length) {
  for (const [what, a, b] of diffs) console.error(`\n   ${what}\n     baseline  ${a}\n     perturbed ${b}`);
  fail("the build is NOT reproducible — something outside the source changed the bytes.");
}

console.log(`\n✅ reproducible: backend bundle${first.pkg ? " and package zip" : ""} identical across both builds.`);
console.log(`   backend  ${first.backend}`);
if (first.pkg) console.log(`   package  ${first.pkg}  (${first.zipName})`);
