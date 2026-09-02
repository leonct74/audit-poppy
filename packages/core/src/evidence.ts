/**
 * Evidence bundles (DESIGN §2.2): the snapshot Lambda (and the on-demand path)
 * write a dated, immutable JSON bundle to the customer's OWN versioned evidence
 * bucket — the "operating effectively over the audit period" record. This
 * module owns the bundle's key scheme and index so the Lambda, the sidecar and
 * the UI agree on where evidence lives.
 */
import type { ControlState, EvidenceBundle, EvidenceBundleSummary, StandardState } from "./types";

/** Where bundles live inside the evidence bucket. */
export const EVIDENCE_PREFIX = "evidence/";
/** Where the poppy stages its own Lambda code (never mixed with evidence). */
export const CODE_PREFIX = "code/";

/** evidence/2026/2026-09-01T00-00-00Z.json — sorts chronologically as strings. */
export function bundleKey(capturedAt: Date): string {
  const iso = capturedAt.toISOString();
  const year = iso.slice(0, 4);
  return `${EVIDENCE_PREFIX}${year}/${iso.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z")}.json`;
}

export interface BuildBundleInput {
  accountId: string;
  region: string;
  standards: StandardState[];
  controls: ControlState[];
  collectedBy: EvidenceBundle["collectedBy"];
  now?: Date;
}

export function buildEvidenceBundle(input: BuildBundleInput): EvidenceBundle {
  const findingCounts: Record<string, number> = {};
  for (const c of input.controls) {
    findingCounts[c.compliance] = (findingCounts[c.compliance] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    capturedAt: (input.now ?? new Date()).toISOString(),
    accountId: input.accountId,
    region: input.region,
    standards: input.standards,
    controls: input.controls,
    findingCounts,
    collectedBy: input.collectedBy,
  };
}

/** Summaries for the Evidence screen + the auditor export's evidence index. */
export function summarizeBundle(key: string, bundle: EvidenceBundle, sizeBytes?: number): EvidenceBundleSummary {
  const totals = { passed: 0, failed: 0, warning: 0, noData: 0, disabled: 0 };
  for (const c of bundle.controls) {
    if (!c.enabled) totals.disabled += 1;
    else if (c.compliance === "PASSED") totals.passed += 1;
    else if (c.compliance === "FAILED") totals.failed += 1;
    else if (c.compliance === "WARNING") totals.warning += 1;
    else totals.noData += 1;
  }
  return { key, capturedAt: bundle.capturedAt, standards: bundle.standards, totals, sizeBytes };
}
