/**
 * Teardown (AGENTS.md §4 — leaves no trace, and DESIGN §3's nuance): disable
 * EXACTLY what the ledger says is ours, never what was found enabled; empty
 * the evidence bucket (all versions); delete the stack; wait for it to go.
 *
 * Idempotent by construction — every step tolerates "already gone", so the
 * host may POST /teardown more than once (including after a partial run).
 * Certification runs with host cleanup OFF: this hook alone must leave zero.
 */
import {
  DeleteConfigurationRecorderCommand,
  DeleteDeliveryChannelCommand,
  StopConfigurationRecorderCommand,
} from "@aws-sdk/client-config-service";
import { DeleteServiceLinkedRoleCommand } from "@aws-sdk/client-iam";
import { DeleteObjectsCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { BatchDisableStandardsCommand, DisableSecurityHubCommand } from "@aws-sdk/client-securityhub";
import { servicesToDisable, type LedgerService } from "@auditpoppy/core";
import { errorMessage, isNotFound, isNotSubscribed } from "./awsErrors";
import type { Clients } from "./clients";
import { DELIVERY_CHANNEL_NAME, RECORDER_NAME } from "./enable";
import type { LedgerStore } from "./ledgerStore";
import { fetchEnabledStandards } from "./readiness";
import { deleteStack, getStackState } from "./stack";
import { evidenceBucketRef, type EvidenceBucketRef } from "./template";

export interface TeardownReport {
  disabled: LedgerService[];
  leftAlone: LedgerService[];
  bucketEmptied: boolean;
  stackDeleted: boolean;
  /** Human-readable problems — teardown continues past each and reports. */
  problems: string[];
}

interface VersionsOutput {
  Versions?: { Key?: string; VersionId?: string }[];
  DeleteMarkers?: { Key?: string; VersionId?: string }[];
  IsTruncated?: boolean;
  NextKeyMarker?: string;
  NextVersionIdMarker?: string;
}

async function emptyBucket(clients: Clients, ref: EvidenceBucketRef): Promise<void> {
  for (;;) {
    let page: VersionsOutput;
    try {
      page = (await clients.s3.send(new ListObjectVersionsCommand({ ...ref, MaxKeys: 1000 }))) as VersionsOutput;
    } catch (err) {
      if (isNotFound(err)) return; // bucket already gone
      throw err;
    }
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
      .filter((v): v is { Key: string; VersionId: string } => !!v.Key && !!v.VersionId)
      .map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
    if (objects.length === 0) return;
    await clients.s3.send(new DeleteObjectsCommand({ ...ref, Delete: { Objects: objects, Quiet: true } }));
    if (!page.IsTruncated) return;
  }
}

async function waitForStackGone(clients: Clients, timeoutMs: number, pollMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await getStackState(clients);
    if (state.status === "ABSENT") return true;
    if (state.status === "FAILED" && state.rawStatus === "DELETE_FAILED") return false;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export interface TeardownInput {
  accountId: string;
  /** Test seam; production waits up to 5 minutes for the stack delete. */
  stackTimeoutMs?: number;
}

/**
 * Disable ONLY the checking services (the Costs screen's off switch, next to
 * the free-trial line — DESIGN §7). The stack, the evidence bucket and every
 * bundle in it stay untouched; the ledger's "found enabled, not ours" rule
 * applies exactly as in full teardown.
 */
export async function disableChecksOnly(clients: Clients, store: LedgerStore): Promise<TeardownReport> {
  const ledger = store.read();
  const ours = new Set(servicesToDisable(ledger));
  const report: TeardownReport = {
    disabled: [],
    leftAlone: ledger.entries.filter((e) => e.preExisting).map((e) => e.service),
    bucketEmptied: false,
    stackDeleted: false,
    problems: [],
  };
  await disableServices(clients, ours, report);
  return report;
}

export async function runTeardown(clients: Clients, store: LedgerStore, input: TeardownInput): Promise<TeardownReport> {
  const ledger = store.read();
  const ours = new Set(servicesToDisable(ledger));
  const report: TeardownReport = {
    disabled: [],
    leftAlone: ledger.entries.filter((e) => e.preExisting).map((e) => e.service),
    bucketEmptied: false,
    stackDeleted: false,
    problems: [],
  };
  await disableServices(clients, ours, report);

  // Empty the evidence bucket (every version + delete marker), then the stack.
  // Never empty a bucket this account does not own — a sniped name would otherwise turn our
  // own teardown into a delete-everything call against a stranger's bucket.
  try {
    await emptyBucket(clients, evidenceBucketRef(input.accountId));
    report.bucketEmptied = true;
  } catch (err) {
    report.problems.push(`empty evidence bucket: ${errorMessage(err)}`);
  }
  try {
    await deleteStack(clients);
    report.stackDeleted = await waitForStackGone(clients, input.stackTimeoutMs ?? 300_000);
    if (!report.stackDeleted) report.problems.push("stack delete did not finish in time — run teardown again");
  } catch (err) {
    report.problems.push(`delete stack: ${errorMessage(err)}`);
  }

  return report;
}

/** The service-disable half, shared by full teardown and the checks-only switch. */
async function disableServices(clients: Clients, ours: Set<LedgerService>, report: TeardownReport): Promise<void> {
  const attempt = async (service: LedgerService | null, what: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      if (service) report.disabled.push(service);
    } catch (err) {
      if (isNotFound(err) || isNotSubscribed(err)) {
        if (service) report.disabled.push(service); // already gone = done
        return;
      }
      report.problems.push(`${what}: ${errorMessage(err)}`);
    }
  };

  // 1. Security Hub standards we enabled (found live, matched to the ledger).
  const standardsOurs = [...ours].filter((s) => s.startsWith("securityhub-standard:"));
  if (standardsOurs.length > 0) {
    await attempt(null, "disable standards", async () => {
      const enabled = await fetchEnabledStandards(clients);
      const arns = enabled
        .filter((e) => ours.has(`securityhub-standard:${e.standard}` as LedgerService))
        .map((e) => e.subscriptionArn);
      if (arns.length > 0) {
        await clients.securityhub.send(new BatchDisableStandardsCommand({ StandardsSubscriptionArns: arns }));
      }
      for (const s of standardsOurs) report.disabled.push(s as LedgerService);
    });
  }

  // 2. Security Hub itself, only if ours.
  if (ours.has("securityhub")) {
    await attempt("securityhub", "disable Security Hub", async () => {
      await clients.securityhub.send(new DisableSecurityHubCommand({}));
    });
  }

  // 3. Config, only if ours: stop → delete channel → delete recorder.
  if (ours.has("config-recorder")) {
    await attempt("config-recorder", "stop+delete Config recorder", async () => {
      try {
        await clients.config.send(new StopConfigurationRecorderCommand({ ConfigurationRecorderName: RECORDER_NAME }));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      if (ours.has("config-delivery-channel")) {
        try {
          await clients.config.send(new DeleteDeliveryChannelCommand({ DeliveryChannelName: DELIVERY_CHANNEL_NAME }));
          report.disabled.push("config-delivery-channel");
        } catch (err) {
          if (!isNotFound(err)) throw err;
          report.disabled.push("config-delivery-channel");
        }
      }
      await clients.config.send(new DeleteConfigurationRecorderCommand({ ConfigurationRecorderName: RECORDER_NAME }));
    });
  }

  // 4. The Config service-linked role, only if we created it.
  if (ours.has("config-slr")) {
    await attempt("config-slr", "delete Config service role", async () => {
      await clients.iam.send(new DeleteServiceLinkedRoleCommand({ RoleName: "AWSServiceRoleForConfig" }));
    });
  }

  // 5. Security Hub's service-linked role, same rule. It arrives with EnableSecurityHub rather
  //    than by our own call, which makes it easy to forget — and a role left behind is a trace.
  //    Deletion can legitimately fail while Security Hub is still on in ANOTHER region; attempt()
  //    records that as a problem and teardown carries on, rather than aborting the whole removal.
  if (ours.has("securityhub-slr")) {
    await attempt("securityhub-slr", "delete Security Hub service role", async () => {
      await clients.iam.send(new DeleteServiceLinkedRoleCommand({ RoleName: "AWSServiceRoleForSecurityHub" }));
    });
  }
}
