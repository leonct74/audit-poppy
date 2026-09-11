/**
 * Assemble the auditor export (DESIGN §2.4) from live AWS state + the
 * customer's saved answers/notes. Rendering (JSON + PDF) is core's, local
 * only — no cloud service ever sees a report. Whether the export carries the
 * personal-use watermark is decided by the LICENSED flag the frontend passes,
 * which it reads from the host's entitlement check (licensing.ts — the
 * watermark is a label, not DRM, by design).
 */
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  buildAuditorExportJson,
  buildAuditorExportPdf,
  EVIDENCE_PREFIX,
  POLICY_TEMPLATES,
  renderPolicy,
  summarizeBundle,
  type AuditorExportJson,
  type EvidenceBundle,
  type EvidenceBundleSummary,
  type Ledger,
  type ObservedPosture,
} from "@auditpoppy/core";
import { isNotFound } from "./awsErrors";
import type { Clients } from "./clients";
import { observePosture } from "./posture";
import { buildLiveGapReport } from "./readiness";
import type { SidecarState } from "./stateStore";
import { evidenceBucketRef, type EvidenceBucketRef } from "./template";

interface ListOutput {
  Contents?: { Key?: string; Size?: number }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

/** Index the evidence bucket's bundles: keys + sizes, newest last (key order). */
export async function listEvidence(clients: Clients, accountId: string): Promise<{ key: string; sizeBytes: number }[]> {
  const ref = evidenceBucketRef(accountId);
  const out: { key: string; sizeBytes: number }[] = [];
  let ContinuationToken: string | undefined;
  try {
    do {
      const res = (await clients.s3.send(
        new ListObjectsV2Command({ ...ref, Prefix: EVIDENCE_PREFIX, ContinuationToken }),
      )) as ListOutput;
      for (const item of res.Contents ?? []) {
        if (item.Key) out.push({ key: item.Key, sizeBytes: item.Size ?? 0 });
      }
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

async function readBundle(
  clients: Clients,
  ref: EvidenceBucketRef,
  key: string,
): Promise<EvidenceBundle | undefined> {
  try {
    const res = (await clients.s3.send(new GetObjectCommand({ ...ref, Key: key }))) as {
      Body?: { transformToString(): Promise<string> };
    };
    const text = await res.Body?.transformToString();
    if (!text) return undefined;
    const bundle = JSON.parse(text) as EvidenceBundle;
    return bundle.schemaVersion === 1 ? bundle : undefined;
  } catch {
    return undefined;
  }
}

/** Bundle summaries for the Evidence screen (reads a bounded number of bodies). */
export async function evidenceSummaries(clients: Clients, accountId: string, maxBodies = 24): Promise<EvidenceBundleSummary[]> {
  const ref = evidenceBucketRef(accountId);
  const listed = await listEvidence(clients, accountId);
  const recent = listed.slice(-maxBodies);
  const summaries: EvidenceBundleSummary[] = [];
  for (const item of recent) {
    const bundle = await readBundle(clients, ref, item.key);
    if (bundle) summaries.push(summarizeBundle(item.key, bundle, item.sizeBytes));
  }
  return summaries;
}

export interface ExportArtifacts {
  json: AuditorExportJson;
  jsonBytes: Buffer;
  pdfBytes: Buffer;
}

export async function buildExport(
  clients: Clients,
  ledger: Ledger,
  state: SidecarState,
  accountId: string,
  region: string,
  licensed: boolean,
): Promise<ExportArtifacts> {
  const [gapReport, posture, evidenceIndex] = await Promise.all([
    buildLiveGapReport(clients, ledger, accountId, region),
    observePosture(clients, accountId, region).catch(
      (): ObservedPosture => ({ accountId, region, observedAt: new Date().toISOString() }),
    ),
    evidenceSummaries(clients, accountId).catch((): EvidenceBundleSummary[] => []),
  ]);
  const policies = POLICY_TEMPLATES.map((t) => renderPolicy(t, posture, state.policyAnswers[t.id] ?? {}));
  const json = buildAuditorExportJson({
    gapReport,
    evidenceIndex,
    policies,
    notes: state.notes,
    licensed,
  });
  return {
    json,
    jsonBytes: Buffer.from(JSON.stringify(json, null, 2)),
    pdfBytes: Buffer.from(buildAuditorExportPdf(json)),
  };
}
