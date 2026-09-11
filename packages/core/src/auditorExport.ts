/**
 * The auditor export (DESIGN §2.4): one dated package — gap status, evidence
 * index, policy set, CUEC-style notes — the customer hands to their CPA firm.
 * JSON here; the PDF rendering builds on pdfLite with the same content.
 *
 * Register discipline: platform-observed facts and customer-entered statements
 * are structurally separate (and typographically distinct in the PDF).
 * Watermark: applied when unlicensed (licensing.ts) — the export is the one
 * surface the license gates.
 */
import { WATERMARK_TEXT, exportsWatermarked } from "./licensing";
import { APPROVED } from "./naming";
import { buildPdf, type PdfBlock } from "./pdfLite";
import type { EvidenceBundleSummary, GapReport, Register } from "./types";
import type { RenderedPolicy } from "./policyPack";

export interface CuecNote {
  text: string;
  register: Register;
}

export interface AuditorExportInput {
  gapReport: GapReport;
  evidenceIndex: EvidenceBundleSummary[];
  policies: RenderedPolicy[];
  /** Customer-entered notes for the auditor (complementary controls etc.). */
  notes: string[];
  licensed: boolean;
  now?: Date;
}

export interface AuditorExportJson {
  schemaVersion: 1;
  generatedAt: string;
  generatedBy: string;
  scopeStatement: string;
  watermark?: string;
  gapReport: GapReport;
  evidenceIndex: EvidenceBundleSummary[];
  policies: RenderedPolicy[];
  notes: CuecNote[];
}

/** The honest scope line (DESIGN §1.4) — stated in every export. */
export const SCOPE_STATEMENT =
  "This package covers the cloud estate, the written policies, and the evidence workflow. " +
  "It is evidence for your SOC 2 audit, mapped to the SOC 2 Trust Services Criteria — " +
  "the audit itself, and any opinion on it, comes only from your CPA firm.";

export function buildAuditorExportJson(input: AuditorExportInput): AuditorExportJson {
  const watermarked = exportsWatermarked(input.licensed);
  return {
    schemaVersion: 1,
    generatedAt: (input.now ?? new Date()).toISOString(),
    generatedBy: `AuditPoppy (${APPROVED.productLine})`,
    scopeStatement: SCOPE_STATEMENT,
    ...(watermarked ? { watermark: WATERMARK_TEXT } : {}),
    gapReport: input.gapReport,
    evidenceIndex: input.evidenceIndex,
    policies: input.policies,
    notes: input.notes.filter((t) => t.trim() !== "").map((text) => ({ text, register: "customer-entered" as const })),
  };
}

const COMPLIANCE_LABEL: Record<string, string> = {
  PASSED: "Pass",
  FAILED: "FAIL",
  WARNING: "Warning",
  NO_DATA: "No data yet",
  NOT_AVAILABLE: "Not available",
};

/** The export as a printable PDF, from the same JSON content. */
export function buildAuditorExportPdf(json: AuditorExportJson): Uint8Array {
  const blocks: PdfBlock[] = [];
  const h1 = (text: string, spaceBefore = 18): void => {
    blocks.push({ text, font: "bold", size: 16, spaceBefore });
  };
  const h2 = (text: string, spaceBefore = 12): void => {
    blocks.push({ text, font: "bold", size: 12, spaceBefore });
  };
  const p = (text: string, spaceBefore = 4): void => {
    blocks.push({ text, size: 10.5, spaceBefore });
  };
  const data = (text: string): void => {
    blocks.push({ text, font: "mono", size: 8.5, spaceBefore: 2, gray: 0.25 });
  };
  const customer = (text: string): void => {
    blocks.push({ text, font: "italic", size: 10.5, spaceBefore: 4 });
  };

  h1("Audit-readiness package", 0);
  data(`Generated ${json.generatedAt} - cloud account ${json.gapReport.accountId} (${json.gapReport.region})`);
  p(json.scopeStatement, 8);
  p(
    "Typography carries the register: regular text is platform-observed fact; italic text was entered by the company; monospace is raw data.",
    6,
  );

  h1("1. Gap report - grouped by Trust Services Criteria");
  const t = json.gapReport.totals;
  p(`Totals: ${t.passed} passing, ${t.failed} failing, ${t.warning} warnings, ${t.noData} awaiting data, ${t.disabled} disabled.`);
  if (json.gapReport.warmingUp) {
    p("Checks are still warming up: standards report PENDING/INCOMPLETE, so this snapshot is partial by construction — not a clean bill.", 4);
  }
  for (const group of json.gapReport.groups) {
    h2(`${group.tsc} - ${group.name}`);
    p(group.description, 2);
    for (const c of group.controls) {
      p(`[${COMPLIANCE_LABEL[c.compliance] ?? c.compliance}] ${c.controlId} (${c.severity}) - ${c.title}`, 6);
      if (c.auditorNote) p(`Why an auditor cares: ${c.auditorNote}`, 2);
      if (c.compliance === "FAILED" && c.fix) p(`Fix: ${c.fix}`, 2);
      if (c.failedResources?.length) data(`Affected: ${c.failedResources.join(", ")}`);
    }
  }
  if (json.gapReport.unmapped.length > 0) {
    h2("Controls not yet in the criteria mapping");
    for (const c of json.gapReport.unmapped) {
      p(`[${COMPLIANCE_LABEL[c.compliance] ?? c.compliance}] ${c.controlId} (${c.standard}) - ${c.title}`, 4);
    }
  }

  h1("2. Evidence index");
  if (json.evidenceIndex.length === 0) {
    p("No evidence bundles collected yet. Bundles are written monthly to the company's own evidence bucket once continuous collection is enabled.");
  } else {
    p("Dated evidence bundles in the company's own S3 evidence bucket (versioned):");
    for (const b of json.evidenceIndex) {
      data(`${b.capturedAt}  ${b.key}  pass:${b.totals.passed} fail:${b.totals.failed}`);
    }
  }

  h1("3. Policy pack");
  p(APPROVED.policyDisclaimer);
  for (const policy of json.policies) {
    h2(policy.title);
    for (const section of policy.sections) {
      blocks.push({ text: section.heading, font: "bold", size: 10.5, spaceBefore: 8 });
      // Policies carry customer-entered values inline; the whole body renders
      // italic to say plainly: these are the company's words, not the platform's.
      customer(section.body);
    }
  }

  h1("4. Notes for the auditor");
  if (json.notes.length === 0) {
    p("None entered.");
  } else {
    for (const note of json.notes) customer(`- ${note.text}`);
  }

  return buildPdf({
    title: "AuditPoppy audit-readiness package",
    ...(json.watermark ? { watermark: json.watermark } : {}),
    blocks,
  });
}
