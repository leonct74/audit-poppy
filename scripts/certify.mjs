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
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

const passthrough = process.argv.slice(2).filter((a) => a !== "--skip-platform-check");
const skipPlatformCheck = process.argv.includes("--skip-platform-check");
/**
 * PREFLIGHT — the two mismatches that silently void a run, checked BEFORE the teardown.
 *
 * Both have now cost a full deploy-use-wait cycle in a real account, and neither was visible in
 * the harness's output: a voided run looks exactly like a good one.
 *
 * 1. A STALE PLATFORM REPO (2026-09-11). The harness runs from the agentspoppy checkout, so an
 *    out-of-date checkout certifies with out-of-date code. The tag sweep was still signing with
 *    the stripped operator key, so it was denied in every region, so `footprint before` read 0
 *    with a whole stack standing — and the run certified anyway. The fix had been on `main` for
 *    a day. The instruction to pull it lived only in a chat message.
 *
 * 2. AN INSTALLED BUILD THAT IS NOT THIS ONE. What gets certified is what the app is running,
 *    not what this repo has built. Skip `npm run install:local`, or skip the relaunch, and the
 *    certificate describes a different build than the code sitting here.
 *
 * An unreachable remote REFUSES rather than assuming the best — this repo's own law is that an
 * unknown must never default to the reassuring answer. `--skip-platform-check` is the deliberate
 * way past, and it is deliberate precisely because it has to be typed.
 */
function git(args) {
  return execFileSync("git", ["-C", platform, ...args], { encoding: "utf8", timeout: 60_000 }).trim();
}

const problems = [];

if (skipPlatformCheck) {
  console.warn("certify: --skip-platform-check — the harness version is NOT verified for this run.");
} else {
  try {
    git(["fetch", "origin", "main", "--quiet"]);
    const behind = Number(git(["rev-list", "--count", "HEAD..origin/main"]));
    if (behind > 0) {
      problems.push(
        `the agentspoppy checkout is ${behind} commit(s) behind origin/main, so the harness — and the\n` +
          `  tag sweep it depends on — would run stale code:\n\n` +
          `    git -C ${platform} pull\n`,
      );
    }
    if (git(["status", "--porcelain"]) !== "") {
      console.warn(
        `certify: ${platform} has uncommitted changes — the harness that runs is what is on disk\n` +
          "  there, not what origin/main says. Continuing; the certificate describes that working tree.",
      );
    }
  } catch (err) {
    problems.push(
      `the agentspoppy checkout could not be checked against origin/main (${String(err.message).split("\n")[0]}).\n` +
        "  That is an unknown, not a pass: a stale harness certifies with stale code. Fix the checkout, or\n" +
        "  if you have decided the version is right, re-run with --skip-platform-check.",
    );
  }
}

const manifest = JSON.parse(readFileSync(join(extensionDir, "extension.json"), "utf8"));
const installedDir = join(process.env.AGENTSPOPPY_HOME ?? join(homedir(), ".agentspoppy"), "extensions", manifest.id);
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
// NOT `manifest.backend.entry` — that is the path INSIDE the installed/packed layout. The
// build writes the bundle where the sidecar workspace builds it, and reaching for the
// manifest path instead is the same trap that broke `certify` and `pack` before it.
const builtBackend = join(extensionDir, "node-sidecar", "dist", "index.cjs");
const installedBackend = join(installedDir, manifest.backend.entry);

if (!existsSync(installedDir)) {
  problems.push(
    `nothing is installed at ${installedDir}, so the app has no build of this poppy to be running:\n\n` +
      "    npm run install:local     # then RELAUNCH AgentsPoppy\n",
  );
} else if (!existsSync(builtBackend)) {
  problems.push(`this repo has no built backend at ${builtBackend} — run \`npm run build\` first.`);
} else if (!existsSync(installedBackend) || sha(builtBackend) !== sha(installedBackend)) {
  problems.push(
    "the INSTALLED build is not the one this repo has built, so the certificate would describe a\n" +
      "  different build than the code here:\n\n" +
      "    npm run install:local     # then RELAUNCH AgentsPoppy\n",
  );
}

if (problems.length > 0) {
  console.error(
    ["certify: not starting — this run would be voided before it began.", "", ...problems.map((p) => `- ${p}`)].join("\n"),
  );
  process.exit(1);
}

console.log(
  [
    "preflight OK",
    `  harness:   ${platform} is up to date with origin/main`,
    `  installed: ${installedDir} matches the build in this repo`,
    "  RELAUNCH AgentsPoppy if you have not since the last install:local — that part cannot be checked from here.",
  ].join("\n"),
);

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
      "Nothing has been torn down. Re-run with:  npm run certify -- --yes",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`certifying ${extensionDir}\n  using the harness in ${platform}`);
execFileSync("npm", ["run", "certify", "--", "--extension", extensionDir, ...passthrough], {
  cwd: platform,
  stdio: "inherit",
});
