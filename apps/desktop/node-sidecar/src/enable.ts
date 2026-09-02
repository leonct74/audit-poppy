/**
 * Baseline capture + the enable flow, exactly as phase 0 proved it live:
 *
 *  - BASELINE FIRST (phase0-derisk.md): before enabling anything, record what
 *    is already on. "Found enabled, not ours" enters the ledger and teardown
 *    never touches it (DESIGN §3).
 *  - ENABLE ORDER (finding 4): Config → wait until recording → Security Hub →
 *    standards. Security Hub's Config-backed controls sit INCOMPLETE without a
 *    recorder, and the UI renders that as "warming up", never as failure.
 *  - WRITE-AHEAD LEDGER: an "ours" entry is persisted BEFORE the enable call.
 *    Over-recording is safe (teardown's disables tolerate absence);
 *    under-recording would orphan an enablement — the dangerous direction.
 *  - TYPED SDK OBJECTS ONLY (finding 2): the recorder's role ARN is built from
 *    the account id by string template ONCE, here, in TypeScript — no shell,
 *    no heredocs, and the SLR path is a constant.
 */
import {
  DescribeConfigurationRecordersCommand,
  DescribeConfigurationRecorderStatusCommand,
  PutConfigurationRecorderCommand,
  PutDeliveryChannelCommand,
  StartConfigurationRecorderCommand,
} from "@aws-sdk/client-config-service";
import { CreateServiceLinkedRoleCommand } from "@aws-sdk/client-iam";
import {
  BatchEnableStandardsCommand,
  DescribeHubCommand,
  DescribeStandardsCommand,
  EnableSecurityHubCommand,
} from "@aws-sdk/client-securityhub";
import { recordService, type Ledger, type LedgerService, type StandardId } from "@auditpoppy/core";
import { isAlreadyExists, isNotSubscribed } from "./awsErrors";
import type { Clients } from "./clients";
import type { LedgerStore } from "./ledgerStore";
import { APP, APP_TAG_KEY } from "./permissionSet";

export const RECORDER_NAME = "default";
export const DELIVERY_CHANNEL_NAME = "default";
/** Config history lands in the evidence bucket under its own prefix. */
export const CONFIG_DELIVERY_PREFIX = "config";

const STANDARD_MARKERS: Record<StandardId, string> = {
  "cis-1.2.0": "cis-aws-foundations-benchmark/v/1.2.0",
  "fsbp-1.0.0": "aws-foundational-security-best-practices/v/1.0.0",
};

export interface BaselineResult {
  configOn: boolean;
  securityHubOn: boolean;
}

interface RecordersOutput {
  ConfigurationRecorders?: { name?: string }[];
}

/**
 * Probe the account and record what was ALREADY on. Idempotent: the ledger
 * keeps only the first observation per service, so re-running after our own
 * enablement can never flip "ours" into "pre-existing" (or back).
 */
export async function captureBaseline(clients: Clients, store: LedgerStore, now = new Date()): Promise<BaselineResult> {
  let ledger = store.read();

  const recorders = (await clients.config.send(new DescribeConfigurationRecordersCommand({}))) as RecordersOutput;
  const configOn = (recorders.ConfigurationRecorders ?? []).length > 0;
  if (configOn) {
    ledger = recordService(ledger, "config-recorder", true, now);
    ledger = recordService(ledger, "config-delivery-channel", true, now);
    ledger = recordService(ledger, "config-slr", true, now);
  }

  let securityHubOn = true;
  try {
    await clients.securityhub.send(new DescribeHubCommand({}));
  } catch (err) {
    if (!isNotSubscribed(err)) throw err;
    securityHubOn = false;
  }
  if (securityHubOn) {
    ledger = recordService(ledger, "securityhub", true, now);
    ledger = recordService(ledger, "securityhub-standard:cis-1.2.0", true, now);
    ledger = recordService(ledger, "securityhub-standard:fsbp-1.0.0", true, now);
  }

  store.write(ledger);
  return { configOn, securityHubOn };
}

interface RecorderStatusOutput {
  ConfigurationRecordersStatus?: { recording?: boolean }[];
}

async function waitForRecording(clients: Clients, timeoutMs: number, pollMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = (await clients.config.send(
      new DescribeConfigurationRecorderStatusCommand({}),
    )) as RecorderStatusOutput;
    if ((status.ConfigurationRecordersStatus ?? []).some((s) => s.recording === true)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export interface EnableConfigInput {
  accountId: string;
  evidenceBucket: string;
  now?: Date;
  /** Test seam; production default waits up to a minute. */
  recordingTimeoutMs?: number;
}

/**
 * Enable AWS Config: SLR → recorder → delivery channel (into the evidence
 * bucket) → start. Skips cleanly when the ledger says it was already on.
 */
export async function enableConfig(clients: Clients, store: LedgerStore, input: EnableConfigInput): Promise<void> {
  let ledger = store.read();
  const pre = ledger.entries.find((e) => e.service === "config-recorder");
  // Pre-existing = not ours: never touch it. An "ours" entry does NOT skip —
  // every call below is an idempotent upsert, so re-running after a partial
  // failure (ledger written, call crashed) finishes the job instead of
  // orphaning it.
  if (pre?.preExisting) return;

  const now = input.now ?? new Date();

  // 1. The service-linked role Config requires (idempotent; phase 0: validates
  //    immediately — no propagation wait needed for a correct request).
  let slrCreated = false;
  try {
    await clients.iam.send(new CreateServiceLinkedRoleCommand({ AWSServiceName: "config.amazonaws.com" }));
    slrCreated = true;
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  if (slrCreated) {
    ledger = recordService(ledger, "config-slr", false, now);
    store.write(ledger);
  }

  // 2. Recorder + delivery channel + start — ledger written ahead of the calls.
  ledger = recordService(ledger, "config-recorder", false, now);
  ledger = recordService(ledger, "config-delivery-channel", false, now);
  store.write(ledger);

  const roleArn = `arn:aws:iam::${input.accountId}:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig`;
  await clients.config.send(
    new PutConfigurationRecorderCommand({
      ConfigurationRecorder: {
        name: RECORDER_NAME,
        roleARN: roleArn,
        recordingGroup: { allSupported: true, includeGlobalResourceTypes: true },
      },
    }),
  );
  await clients.config.send(
    new PutDeliveryChannelCommand({
      DeliveryChannel: {
        name: DELIVERY_CHANNEL_NAME,
        s3BucketName: input.evidenceBucket,
        s3KeyPrefix: CONFIG_DELIVERY_PREFIX,
      },
    }),
  );
  await clients.config.send(new StartConfigurationRecorderCommand({ ConfigurationRecorderName: RECORDER_NAME }));
}

interface DescribeStandardsOutput {
  Standards?: { StandardsArn?: string }[];
  NextToken?: string;
}

/** Resolve the two pinned standards' ARNs from the LIVE catalogue (no guessed ARNs). */
export async function resolveStandardArns(clients: Clients): Promise<Partial<Record<StandardId, string>>> {
  const found: Partial<Record<StandardId, string>> = {};
  let NextToken: string | undefined;
  do {
    const res = (await clients.securityhub.send(new DescribeStandardsCommand({ NextToken }))) as DescribeStandardsOutput;
    for (const std of res.Standards ?? []) {
      const arn = std.StandardsArn ?? "";
      for (const [id, marker] of Object.entries(STANDARD_MARKERS) as [StandardId, string][]) {
        if (arn.includes(marker)) found[id] = arn;
      }
    }
    NextToken = res.NextToken;
  } while (NextToken);
  return found;
}

export interface EnableChecksInput extends EnableConfigInput {
  connectionId?: string;
}

export interface EnableChecksResult {
  configEnabled: boolean;
  recording: boolean;
  securityHubEnabled: boolean;
  standardsEnabled: StandardId[];
}

/**
 * The whole flow, in the proven order: Config → recording → Security Hub →
 * both pinned standards. Idempotent — re-running after a partial failure
 * finishes the remaining steps.
 */
export async function enableChecks(clients: Clients, store: LedgerStore, input: EnableChecksInput): Promise<EnableChecksResult> {
  const now = input.now ?? new Date();

  await enableConfig(clients, store, input);
  const recording = await waitForRecording(clients, input.recordingTimeoutMs ?? 60_000);

  let ledger = store.read();
  const securityHubEnabled = true;
  const hubEntry = ledger.entries.find((e) => e.service === "securityhub");
  if (!hubEntry?.preExisting) {
    // Ours (or not yet attempted): record write-ahead and enable. The call is
    // tolerant of "already enabled", so retries after a partial run are safe.
    ledger = recordService(ledger, "securityhub", false, now);
    store.write(ledger);
    try {
      await clients.securityhub.send(
        new EnableSecurityHubCommand({
          EnableDefaultStandards: false, // we pin our own standard versions
          Tags: { [APP_TAG_KEY]: APP.id },
        }),
      );
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
  }

  const arns = await resolveStandardArns(clients);
  const toEnable: { id: StandardId; arn: string }[] = [];
  ledger = store.read();
  for (const id of ["cis-1.2.0", "fsbp-1.0.0"] as StandardId[]) {
    const service = `securityhub-standard:${id}` as LedgerService;
    const entry = ledger.entries.find((e) => e.service === service);
    if (entry?.preExisting) continue; // found enabled — not ours to manage
    const arn = arns[id];
    if (!arn) continue; // not in this region's catalogue — surfaced by /status
    ledger = recordService(ledger, service, false, now);
    toEnable.push({ id, arn });
  }
  if (toEnable.length > 0) {
    store.write(ledger);
    await clients.securityhub.send(
      new BatchEnableStandardsCommand({
        StandardsSubscriptionRequests: toEnable.map((s) => ({ StandardsArn: s.arn })),
      }),
    );
  }

  return {
    configEnabled: true,
    recording,
    securityHubEnabled,
    standardsEnabled: toEnable.map((s) => s.id),
  };
}
