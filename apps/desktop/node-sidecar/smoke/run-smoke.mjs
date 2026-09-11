#!/usr/bin/env node
/**
 * The smoke drive: mock AWS + the REAL sidecar (typed SDK clients and all),
 * through the whole product loop with assertions — the closest thing to the
 * sandbox run that needs no credentials.
 *
 *   Scenario A (clean account): baseline → costs (live prices) → enable
 *     (storage first, Config before Security Hub) → warming-up report → ready
 *     report → two-phase deploy → snapshot → policies → export (watermark on
 *     unlicensed ONLY) → disable-checks → teardown → leaves-no-trace sweep of
 *     the mock's state.
 *   Scenario B (found enabled, not ours): baseline records pre-existing;
 *     enable touches nothing; teardown leaves the account's own services on.
 *
 *   npm run smoke                     (from apps/desktop/node-sidecar)
 *
 * One-time setup (S3's virtual-host addressing needs resolvable names):
 *   echo "127.0.0.1 aws.local auditpoppy-evidence-111122223333.aws.local" | sudo tee -a /etc/hosts
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidecarRoot = resolve(here, "..");
const repoRoot = resolve(sidecarRoot, "..", "..", "..");
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");

const MOCK_PORT = 9911;
const SIDECAR_PORT = 8788;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const API = `http://127.0.0.1:${SIDECAR_PORT}`;

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}
const mockState = async () => (await fetch(`${MOCK}/__state`)).json();

/** GET /status over raw http, so headers fetch() refuses to send can be tested. */
function rawStatus(headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: Number(new URL(API).port), path: "/status", method: "GET", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(what, fn, timeoutMs = 60_000, pollMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(pollMs);
  }
}

function spawnLogged(name, cmd, args, opts) {
  // detached → own process group, so killing -pid takes tsx's CHILD node
  // process down too (killing only the wrapper leaves a zombie server owning
  // the port — the first smoke run proved it).
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stdout.write(`[${name}!] ${d}`));
  return child;
}

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

let sidecar = null;
async function startSidecar(dataDirLabel) {
  const cwd = mkdtempSync(join(tmpdir(), `auditpoppy-smoke-${dataDirLabel}-`));
  sidecar = spawnLogged("sidecar", tsx, [join(sidecarRoot, "src", "index.ts")], {
    cwd,
    env: {
      ...process.env,
      AWS_ENDPOINT_URL: "http://aws.local:9911",
      AWS_ACCESS_KEY_ID: "mock",
      AWS_SECRET_ACCESS_KEY: "mock",
      AWS_REGION: "eu-west-1",
      PORT: String(SIDECAR_PORT),
      AGENTSPOPPY_BOOTSTRAP: "",
    },
  });
  await waitFor("sidecar health", async () => {
    try {
      return (await api("GET", "/health")).ok;
    } catch {
      return false;
    }
  }, 30_000);
  return cwd;
}
async function stopSidecar() {
  if (!sidecar) return;
  const child = sidecar;
  sidecar = null;
  const gone = new Promise((r) => child.once("exit", r));
  killTree(child);
  await gone;
  // And wait for the port to actually free, so the next scenario's health
  // check can never latch onto a dying predecessor.
  await waitFor("port to free", async () => {
    try {
      await fetch(`${API}/health`);
      return false;
    } catch {
      return true;
    }
  }, 10_000, 200);
}

// ---------------- Scenario A — a clean account ----------------
async function scenarioA() {
  console.log("\n━━ Scenario A: clean account — the full loop ━━");
  await fetch(`${MOCK}/__reset`, { method: "POST", body: JSON.stringify({ preEnabled: false }) });
  const cwd = await startSidecar("clean");

  // Who may talk to this port at all. The unit tests pin the predicate; this pins the WIRING —
  // that the check actually runs before any route does, on the real server, over real HTTP.
  const rejected = await fetch(`${API}/status`, { headers: { origin: "https://evil.example" } });
  check("guard: a request carrying an Origin is refused — no browser drives this port", rejected.status === 403);
  // fetch() will NOT send a Host we choose — it is a forbidden header, silently dropped — so a
  // fetch-based version of this check passes while proving nothing. Raw http can set it, which
  // is also what a rebinding browser does.
  const rebound = await rawStatus({ host: "attacker.example" });
  check("guard: a rebound hostname is refused even with no Origin", rebound === 403, `got ${rebound}`);
  check("guard: the host's own loopback call still gets through", (await rawStatus({})) === 200);
  const teardownAttempt = await fetch(`${API}/teardown`, { method: "POST", headers: { origin: "null" } });
  check("guard: the destructive route is behind the same check", teardownAttempt.status === 403);

  const status0 = await api("GET", "/status");
  check("status: resolves the account from STS", status0.account === "111122223333");
  check("status: all standards NOT_ENABLED on a clean account",
    status0.readiness?.standards?.every((s) => s.status === "NOT_ENABLED"), JSON.stringify(status0.readiness));
  check("status: stack ABSENT", status0.stack?.status === "ABSENT");

  const costs = await api("GET", "/costs");
  check("costs: resource count computed from live describes", costs.resourceCount >= 20, String(costs.resourceCount));
  check("costs: unit prices came from the LIVE pricing path", costs.estimate?.source === "live" && costs.approxFallback === false);
  check("costs: every line item priced with detail",
    costs.estimate?.items?.length === 3 && costs.estimate.items.every((i) => i.monthlyUsd >= 0 && i.detail.length > 10));

  const baseline = await api("POST", "/baseline");
  check("baseline: clean — nothing pre-existing", baseline.configOn === false && baseline.securityHubOn === false && baseline.ledger.entries.length === 0);

  await api("POST", "/enable");
  const enabled = await waitFor("enable flow to finish", async () => {
    const s = await api("GET", "/status");
    if (s.enableOp?.error) throw new Error(`enable failed: ${s.enableOp.error}`);
    return s.enableOp?.finishedAt ? s : null;
  }, 120_000, 1000);
  check("enable: finished without error", !!enabled.enableOp?.finishedAt);
  check("enable: free-trial clock started", !!enabled.securityHubEnabledAt && !!enabled.freeTrial?.endsOn);

  const m1 = await mockState();
  check("enable: recorder present and RECORDING", m1.config.recorder !== null && m1.config.recording === true);
  check("enable: delivery channel points at the evidence bucket with the config prefix",
    m1.config.deliveryChannel?.bucket === "auditpoppy-evidence-111122223333" && m1.config.deliveryChannel?.prefix === "config");
  check("enable: Security Hub on with both pinned standards", m1.securityhub.enabled === true && m1.securityhub.subscriptions.length === 2);
  check("enable: storage stack was created FIRST (the bucket the channel needs)", m1.stack !== null);

  // The proven order: StartConfigurationRecorder strictly before EnableSecurityHub.
  const allCalls = m1.calls; // last 40 is plenty — enable just ran
  const iStart = allCalls.findIndex((c) => c.op === "StartConfigurationRecorder");
  const iHub = allCalls.findIndex((c) => c.proto === "securityhub" && c.method === "POST" && c.path === "/accounts");
  check("enable: Config recording BEFORE Security Hub (finding 4)", iStart !== -1 && iHub !== -1 && iStart < iHub, `start=${iStart} hub=${iHub}`);

  const warmReport = await api("GET", "/report");
  check("report: warming up while standards are PENDING — never falsely clean", warmReport.warmingUp === true);

  await waitFor("standards to settle", async () => ((await api("GET", "/status")).warmingUp ? null : true), 30_000, 500);
  const report = await api("GET", "/report");
  check("report: settles to READY", report.warmingUp === false);
  check("report: totals match the account's real findings",
    report.totals.failed === 5 && report.totals.warning === 1 && report.totals.passed === 5 && report.totals.noData === 1 && report.totals.disabled === 1,
    JSON.stringify(report.totals));
  const cc6 = report.groups.find((g) => g.tsc === "CC6");
  check("report: grouped by criteria with auditor prose + fix",
    !!cc6 && cc6.controls.some((c) => c.controlId === "CIS.1.13" && c.auditorNote && c.fix));
  check("report: failing controls name affected resources",
    cc6?.controls.find((c) => c.controlId === "CIS.1.13")?.failedResources?.includes("arn:aws:iam::111122223333:root") === true);
  check("report: unknown AWS checks stay visible, flagged unmapped", report.unmapped.some((c) => c.controlId === "FOO.1"));

  let stack = await api("POST", "/deploy");
  stack = await waitFor("stack COMPLETE (two-phase)", async () => {
    const s = await api("POST", "/deploy");
    return s.status === "COMPLETE" ? s : null;
  }, 60_000, 700);
  const m2 = await mockState();
  check("deploy: phase B uploaded the snapshot code then updated the stack",
    typeof m2.stack?.codeKey === "string" && m2.stack.codeKey.startsWith("code/snapshot-") &&
    Object.keys(m2.s3["auditpoppy-evidence-111122223333"] ?? {}).some((k) => k.startsWith("code/")));

  const snap = await api("POST", "/snapshot");
  check("snapshot: on-demand bundle written under evidence/", snap.ok === true && snap.key.startsWith("evidence/"));
  const evidence = await api("GET", "/evidence");
  check("evidence: bundle listed with totals", evidence.bundles.length === 1 && evidence.bundles[0].totals.failed === 5);

  const policies = await api("GET", "/policies");
  const access = policies.rendered.find((p) => p.id === "access-control");
  check("policies: prefilled from the OBSERVED posture (3 users, 1 without MFA)",
    access?.fields.find((f) => f.id === "iamUserCount")?.value === "3" &&
    access?.fields.find((f) => f.id === "usersWithoutMfa")?.value === "1");
  await api("POST", "/policies/answers", { policyId: "access-control", answers: { companyName: "Acme GmbH", accessApprover: "The CTO" } });
  const policies2 = await api("GET", "/policies");
  check("policies: answers persist and render into the body",
    policies2.rendered.find((p) => p.id === "access-control")?.sections.some((s) => s.body.includes("Acme GmbH")) === true);

  await api("POST", "/notes", { notes: ["Change approvals happen in GitHub pull requests."] });

  const exportUnlicensed = await api("POST", "/export", { licensed: false });
  check("export: unlicensed build is watermarked", exportUnlicensed.watermarked === true);
  const pdfRes = await fetch(`${API}/local-download/${exportUnlicensed.pdfToken}`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer()).toString("latin1");
  check("export: a real PDF comes back through the one-shot download", pdf.startsWith("%PDF-1.4") && pdfRes.headers.get("content-type") === "application/pdf");
  check("export: the watermark is printed on the PDF pages", pdf.includes("not licensed for business use"));
  check("export: the gap report made it into the PDF", pdf.includes("CIS.1.13"));
  const pdfAgain = await fetch(`${API}/local-download/${exportUnlicensed.pdfToken}`);
  check("export: download tokens are one-shot", pdfAgain.status === 404);
  const jsonBody = await (await fetch(`${API}/local-download/${exportUnlicensed.jsonToken}`)).json();
  check("export: JSON carries report + policies + evidence index + notes",
    jsonBody.gapReport?.totals?.failed === 5 && jsonBody.policies?.length === 5 &&
    jsonBody.evidenceIndex?.length === 1 && jsonBody.notes?.[0]?.register === "customer-entered");
  const exportLicensed = await api("POST", "/export", { licensed: true });
  const pdfClean = Buffer.from(await (await fetch(`${API}/local-download/${exportLicensed.pdfToken}`)).arrayBuffer()).toString("latin1");
  check("export: licensed build is CLEAN", exportLicensed.watermarked === false && !pdfClean.includes("not licensed for business use"));

  const disabled = await api("POST", "/disable-checks");
  const m3 = await mockState();
  check("disable-checks: turns OUR services off", disabled.problems.length === 0 && m3.securityhub.enabled === false && m3.config.recorder === null);
  check("disable-checks: evidence stays (the stack and bundles survive)",
    m3.stack !== null && Object.keys(m3.s3["auditpoppy-evidence-111122223333"] ?? {}).length > 0);

  const teardown = await api("POST", "/teardown");
  const m4 = await mockState();
  check("teardown: clean report", teardown.problems.length === 0 && teardown.bucketEmptied === true && teardown.stackDeleted === true);
  check("teardown: LEAVES NO TRACE in the mock account",
    m4.config.recorder === null && m4.securityhub.enabled === false && m4.slrExists === false &&
    m4.stack === null && m4.s3["auditpoppy-evidence-111122223333"] === undefined);

  await stopSidecar();
  rmSync(cwd, { recursive: true, force: true });
}

// ---------------- Scenario B — found enabled, not ours ----------------
async function scenarioB() {
  console.log("\n━━ Scenario B: services already on — found enabled, not ours ━━");
  await fetch(`${MOCK}/__reset`, { method: "POST", body: JSON.stringify({ preEnabled: true }) });
  const cwd = await startSidecar("preenabled");

  const baseline = await api("POST", "/baseline");
  check("baseline: records everything as PRE-EXISTING", baseline.configOn === true && baseline.securityHubOn === true &&
    baseline.ledger.entries.length >= 5 && baseline.ledger.entries.every((e) => e.preExisting === true));

  const report = await api("GET", "/report");
  check("report: works read-only against an account with its own checks", report.warmingUp === false && report.totals.failed === 5);

  const before = await mockState();
  await api("POST", "/enable");
  await waitFor("enable to finish", async () => {
    const s = await api("GET", "/status");
    if (s.enableOp?.error) throw new Error(`enable failed: ${s.enableOp.error}`);
    return s.enableOp?.finishedAt ? s : null;
  }, 120_000, 1000);
  const after = await mockState();
  const touched = (calls) => calls.filter((c) => c.op === "PutConfigurationRecorder" || (c.proto === "securityhub" && c.method === "POST" && c.path === "/accounts") || (c.proto === "securityhub" && c.path === "/standards/register")).length;
  check("enable: never touches the account's own services", touched(after.calls) === 0 && after.securityhub.subscriptions.length === 2,
    JSON.stringify(after.calls.filter((c) => c.proto === "securityhub")));
  check("enable: still sets up OUR storage stack", after.stack !== null && before.stack === null);

  const teardown = await api("POST", "/teardown");
  const m = await mockState();
  check("teardown: removes only OURS — the stack and bucket", teardown.stackDeleted === true && m.stack === null &&
    m.s3["auditpoppy-evidence-111122223333"] === undefined);
  check("teardown: the account's own Config keeps RECORDING", m.config.recorder !== null && m.config.recording === true);
  check("teardown: the account's own Security Hub stays ON", m.securityhub.enabled === true && m.securityhub.subscriptions.length === 2);
  check("teardown: reports what it deliberately left alone", teardown.leftAlone.length >= 5);

  await stopSidecar();
  rmSync(cwd, { recursive: true, force: true });
}

// ---------------- run ----------------
try {
  await lookup("auditpoppy-evidence-111122223333.aws.local");
} catch {
  console.error(
    'smoke needs the mock hostnames — run once:\n  echo "127.0.0.1 aws.local auditpoppy-evidence-111122223333.aws.local" | sudo tee -a /etc/hosts',
  );
  process.exit(2);
}
const mock = spawnLogged("mock", process.execPath, [join(here, "mock-aws.mjs")], { cwd: here });
try {
  await waitFor("mock AWS", async () => {
    try {
      return (await fetch(`${MOCK}/__state`)).ok;
    } catch {
      return false;
    }
  }, 15_000);
  console.log("mock AWS up — driving the real sidecar against it");
  await scenarioA();
  await scenarioB();
} catch (err) {
  failures.push(String(err));
  console.error(`\n✗ smoke aborted: ${err}`);
} finally {
  await stopSidecar().catch(() => {});
  killTree(mock);
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✅ smoke: the full loop holds — both laws, both scenarios");
