/**
 * The AuditPoppy sidecar — a confined node22 process the host spawns. The
 * frontend reaches it only through host.invokeBackend (the host proxies to the
 * loopback port injected in the bootstrap).
 *
 * Every route reconstructs from live state (AGENTS.md §5): nothing here trusts
 * in-memory progress across restarts, and the one long-running flow (enable)
 * reports its progress via /status so a remounted UI re-attaches.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  APPROX_UNIT_PRICES,
  buildEvidenceBundle,
  bundleKey,
  estimateMonthlyCosts,
  freeTrial,
  isWarmingUp,
  MAPPING,
  MAPPING_VERSION,
  POLICY_TEMPLATES,
  renderPolicy,
} from "@auditpoppy/core";
import { errorMessage, isInvalidToken, isThrottled } from "./awsErrors";
import { resolveEnv } from "./bootstrap";
import { makeClients } from "./clients";
import { captureBaseline, enableChecks } from "./enable";
import { buildExport, evidenceSummaries } from "./exporter";
import { LedgerStore } from "./ledgerStore";
import { observePosture, estimateResourceCount } from "./posture";
import { fetchUnitPrices } from "./pricing";
import { buildLiveGapReport, fetchReadiness } from "./readiness";
import { advanceDeploy, getStackState } from "./stack";
import { recordScan, StateStore } from "./stateStore";
import { disableChecksOnly, runTeardown } from "./teardown";
import { evidenceBucketName } from "./template";
import { lambdaCodeKey, lambdaZipBase64 } from "./generated/lambda-bundle";

const env = resolveEnv();
const clients = makeClients(env);
const ledgerStore = new LedgerStore(env.dataDir);
const stateStore = new StateStore(env.dataDir);

let cachedAccountId: string | undefined = env.accountId;
async function accountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const res = (await clients.sts.send(new GetCallerIdentityCommand({}))) as { Account?: string };
  if (!res.Account) throw new Error("could not resolve the cloud account id");
  cachedAccountId = res.Account;
  return cachedAccountId;
}

// ---- The one long-running operation: the enable flow. Progress lives here,
//      but truth lives in AWS — /status merges both, so a UI remount resumes.
interface EnableOp {
  startedAt: string;
  finishedAt?: string;
  error?: string;
}
let enableOp: EnableOp | null = null;

/**
 * Config's delivery channel points at the evidence bucket, so the storage
 * half of the stack must exist BEFORE Config enables (the smoke harness
 * caught this: phase 0 had created the bucket by hand). Drives the same
 * resumable advanceDeploy the Evidence screen uses.
 */
async function ensureEvidenceStorage(account: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const state = await advanceDeploy(clients, {
      accountId: account,
      connectionId: env.bootstrap?.connectionId,
      permissionsBoundaryArn: env.bootstrap?.permissionsBoundaryArn,
      lambdaCodeKey,
      lambdaZip: Buffer.from(lambdaZipBase64, "base64"),
    });
    if (state.status === "STORAGE_READY" || state.status === "COMPLETE") return;
    if (state.status === "FAILED") {
      throw new Error(`setting up the evidence storage failed${state.statusReason ? `: ${state.statusReason}` : ""}`);
    }
    if (Date.now() > deadline) throw new Error("setting up the evidence storage took too long — try again");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function startEnable(): Promise<void> {
  if (enableOp && !enableOp.finishedAt && !enableOp.error) return; // already running
  enableOp = { startedAt: new Date().toISOString() };
  try {
    const account = await accountId();
    await captureBaseline(clients, ledgerStore);
    await ensureEvidenceStorage(account);
    const result = await enableChecks(clients, ledgerStore, {
      accountId: account,
      evidenceBucket: evidenceBucketName(account),
    });
    if (result.standardsEnabled.length > 0 || result.securityHubEnabled) {
      stateStore.update((s) => {
        s.securityHubEnabledAt ??= new Date().toISOString();
      });
    }
    enableOp = { ...enableOp, finishedAt: new Date().toISOString() };
  } catch (err) {
    // "Rate exceeded" is what AWS says; it tells the person reading it nothing they can act on.
    // The SDK already retried with adaptive backoff, so reaching here means the burst genuinely
    // did not drain — and the honest instruction is "wait, then press it again", plus the fact
    // that nothing is half-broken: enable is idempotent and the ledger recorded what got through.
    enableOp = {
      ...enableOp,
      error: isThrottled(err)
        ? "Your cloud provider is limiting how fast we may call it right now. Nothing was left half-done — wait a minute and start the audit again; it picks up from where it got to."
        : isInvalidToken(err)
          ? "AuditPoppy's access to your cloud account expired mid-run. Start the audit again — it re-connects on its own and picks up from where it got to."
          : errorMessage(err),
    };
  }
}

// ---- One-shot local downloads (confinement-safe file handoff, AGENTS.md §7).
interface PendingDownload {
  filename: string;
  contentType: string;
  buf: Buffer;
  timer: NodeJS.Timeout;
}
const pendingDownloads = new Map<string, PendingDownload>();
const DOWNLOAD_TTL_MS = 120_000;

function stageDownload(filename: string, contentType: string, buf: Buffer): string {
  const token = randomUUID();
  const timer = setTimeout(() => pendingDownloads.delete(token), DOWNLOAD_TTL_MS);
  timer.unref?.();
  pendingDownloads.set(token, { filename, contentType, buf, timer });
  return token;
}

// ---- Routes ----

type Handler = (body: unknown, req: IncomingMessage) => Promise<unknown>;

const routes = new Map<string, Handler>();
const route = (method: string, path: string, handler: Handler): void => {
  routes.set(`${method} ${path}`, handler);
};

route("GET", "/health", async () => ({ ok: true }));

route("GET", "/status", async () => {
  const account = await accountId().catch(() => undefined);
  const ledger = ledgerStore.read();
  const state = stateStore.read();
  const [readiness, stack] = await Promise.all([
    account ? fetchReadiness(clients, ledger).catch((err) => ({ error: errorMessage(err) })) : null,
    getStackState(clients).catch((err) => ({ status: "ABSENT" as const, statusReason: errorMessage(err) })),
  ]);
  const trial = state.securityHubEnabledAt ? freeTrial(state.securityHubEnabledAt, new Date()) : undefined;
  const warmingUp = readiness && "standards" in readiness ? isWarmingUp(readiness.standards) : false;
  return {
    account: account ?? null,
    region: env.region,
    containerMode: env.bootstrap !== null,
    ledger,
    readiness,
    warmingUp,
    stack,
    enableOp,
    securityHubEnabledAt: state.securityHubEnabledAt ?? null,
    freeTrial: trial ?? null,
    mappingVersion: MAPPING_VERSION,
  };
});

route("POST", "/baseline", async () => {
  const baseline = await captureBaseline(clients, ledgerStore);
  return { ...baseline, ledger: ledgerStore.read() };
});

route("GET", "/costs", async () => {
  const [resourceCount, prices] = await Promise.all([estimateResourceCount(clients), fetchUnitPrices(clients)]);
  const enabledControls = MAPPING.length; // the two pinned standards' mapped controls
  const estimate = estimateMonthlyCosts({ resourceCount, enabledControls }, prices);
  const state = stateStore.read();
  const trial = state.securityHubEnabledAt ? freeTrial(state.securityHubEnabledAt, new Date()) : undefined;
  return { resourceCount, estimate, approxFallback: prices === APPROX_UNIT_PRICES, freeTrial: trial ?? null };
});

route("POST", "/enable", async () => {
  void startEnable();
  return { started: true };
});

route("GET", "/report", async () => {
  const account = await accountId();
  const report = await buildLiveGapReport(clients, ledgerStore.read(), account, env.region);
  void recordScan(clients, report);
  return report;
});

route("GET", "/posture", async () => {
  const account = await accountId();
  return observePosture(clients, account, env.region);
});

route("POST", "/deploy", async () => {
  const account = await accountId();
  return advanceDeploy(clients, {
    accountId: account,
    connectionId: env.bootstrap?.connectionId,
    permissionsBoundaryArn: env.bootstrap?.permissionsBoundaryArn,
    lambdaCodeKey,
    lambdaZip: Buffer.from(lambdaZipBase64, "base64"),
  });
});

route("GET", "/evidence", async () => {
  const account = await accountId();
  return { bundles: await evidenceSummaries(clients, account) };
});

route("POST", "/snapshot", async () => {
  const account = await accountId();
  const readiness = await fetchReadiness(clients, ledgerStore.read());
  const bundle = buildEvidenceBundle({
    accountId: account,
    region: env.region,
    standards: readiness.standards,
    controls: readiness.controls,
    collectedBy: "on-demand",
  });
  const key = bundleKey(new Date(bundle.capturedAt));
  await clients.s3.send(
    new PutObjectCommand({
      Bucket: evidenceBucketName(account),
      Key: key,
      Body: JSON.stringify(bundle),
      ContentType: "application/json",
    }),
  );
  return { ok: true, key };
});

route("GET", "/policies", async () => {
  const account = await accountId();
  const posture = await observePosture(clients, account, env.region);
  const state = stateStore.read();
  return {
    templates: POLICY_TEMPLATES,
    rendered: POLICY_TEMPLATES.map((t) => renderPolicy(t, posture, state.policyAnswers[t.id] ?? {})),
    answers: state.policyAnswers,
  };
});

route("POST", "/policies/answers", async (body) => {
  const { policyId, answers } = (body ?? {}) as { policyId?: string; answers?: Record<string, string> };
  if (!policyId || typeof answers !== "object" || answers === null) {
    throw Object.assign(new Error("policyId and answers are required"), { statusCode: 400 });
  }
  const state = stateStore.update((s) => {
    s.policyAnswers[policyId] = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  });
  return { ok: true, answers: state.policyAnswers };
});

route("GET", "/notes", async () => ({ notes: stateStore.read().notes }));

route("POST", "/notes", async (body) => {
  const { notes } = (body ?? {}) as { notes?: unknown };
  if (!Array.isArray(notes) || notes.some((n) => typeof n !== "string")) {
    throw Object.assign(new Error("notes must be an array of strings"), { statusCode: 400 });
  }
  stateStore.update((s) => {
    s.notes = notes as string[];
  });
  return { ok: true };
});

route("POST", "/export", async (body) => {
  const { licensed } = (body ?? {}) as { licensed?: boolean };
  const account = await accountId();
  const artifacts = await buildExport(
    clients,
    ledgerStore.read(),
    stateStore.read(),
    account,
    env.region,
    licensed === true,
  );
  const stamp = artifacts.json.generatedAt.slice(0, 10);
  return {
    generatedAt: artifacts.json.generatedAt,
    watermarked: !!artifacts.json.watermark,
    jsonToken: stageDownload(`auditpoppy-export-${stamp}.json`, "application/json", artifacts.jsonBytes),
    pdfToken: stageDownload(`auditpoppy-export-${stamp}.pdf`, "application/pdf", artifacts.pdfBytes),
  };
});

route("POST", "/disable-checks", async () => disableChecksOnly(clients, ledgerStore));

route("POST", "/teardown", async () => {
  const account = await accountId();
  return runTeardown(clients, ledgerStore, { accountId: account });
});

// ---- The server ----

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  // One-shot download route (opened via the system browser through /ext-dl/).
  const dl = url.pathname.match(/^\/local-download\/([0-9a-f-]+)$/);
  if (req.method === "GET" && dl) {
    const item = pendingDownloads.get(dl[1] ?? "");
    if (!item) {
      json(res, 404, { ok: false, message: "Download expired or already used — export again." });
      return;
    }
    clearTimeout(item.timer);
    pendingDownloads.delete(dl[1] ?? "");
    const safe = item.filename.replace(/["\\\r\n]/g, "_");
    res.statusCode = 200;
    res.setHeader("content-type", item.contentType);
    res.setHeader("content-disposition", `attachment; filename="${safe}"`);
    res.setHeader("content-length", String(item.buf.length));
    res.end(item.buf);
    return;
  }

  const handler = routes.get(`${req.method} ${url.pathname}`);
  if (!handler) {
    json(res, 404, { ok: false, message: `no route for ${req.method} ${url.pathname}` });
    return;
  }
  try {
    const body = req.method === "GET" ? undefined : await readBody(req);
    json(res, 200, await handler(body, req));
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    json(res, status, { ok: false, message: errorMessage(err) });
  }
});

server.listen(env.port, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : env.port;
  console.log(`[auditpoppy] sidecar listening on 127.0.0.1:${port} (${env.bootstrap ? "container" : "developer"} mode)`);
});
