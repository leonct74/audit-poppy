import { describe, expect, it } from "vitest";
import { buildAuditorExportJson, buildAuditorExportPdf, SCOPE_STATEMENT } from "./auditorExport";
import { buildGapReport } from "./gapReport";
import { WATERMARK_TEXT } from "./licensing";
import { checkCopy } from "./naming";
import { POLICY_TEMPLATES, renderPolicy } from "./policyPack";
import type { ObservedPosture } from "./types";

const posture: ObservedPosture = {
  accountId: "111122223333",
  region: "eu-west-1",
  observedAt: "2026-09-02T10:00:00Z",
};

const gapReport = buildGapReport({
  accountId: "111122223333",
  region: "eu-west-1",
  standards: [
    { standard: "cis-1.2.0", status: "READY" },
    { standard: "fsbp-1.0.0", status: "READY" },
  ],
  recorder: { present: true, recording: true },
  controls: [
    {
      controlId: "CIS.1.13",
      standard: "cis-1.2.0",
      title: "Ensure MFA is enabled for the root account",
      enabled: true,
      severity: "CRITICAL",
      compliance: "FAILED",
      failedResources: ["arn:aws:iam::111122223333:root"],
    },
  ],
});

const input = {
  gapReport,
  evidenceIndex: [],
  policies: [renderPolicy(POLICY_TEMPLATES[0]!, posture, { companyName: "Acme Ltd" })],
  notes: ["Customer-managed change approvals happen in GitHub."],
};

describe("the auditor export", () => {
  it("watermarks unlicensed exports — and ONLY unlicensed ones", () => {
    expect(buildAuditorExportJson({ ...input, licensed: false }).watermark).toBe(WATERMARK_TEXT);
    expect(buildAuditorExportJson({ ...input, licensed: true }).watermark).toBeUndefined();
  });

  it("keeps customer notes in their register", () => {
    const json = buildAuditorExportJson({ ...input, licensed: true });
    expect(json.notes[0]?.register).toBe("customer-entered");
  });

  it("states the honest scope, within the naming law", () => {
    expect(SCOPE_STATEMENT).toContain("evidence for your SOC 2 audit");
    expect(checkCopy(SCOPE_STATEMENT)).toEqual([]);
  });

  it("renders a real PDF, watermark on unlicensed pages only", () => {
    const unlicensed = buildAuditorExportPdf(buildAuditorExportJson({ ...input, licensed: false }));
    const licensed = buildAuditorExportPdf(buildAuditorExportJson({ ...input, licensed: true }));
    const asText = (b: Uint8Array): string => Buffer.from(b).toString("latin1");
    expect(asText(unlicensed).startsWith("%PDF-1.4")).toBe(true);
    expect(asText(unlicensed).trimEnd().endsWith("%%EOF")).toBe(true);
    expect(asText(unlicensed)).toContain("not licensed for business use");
    expect(asText(licensed)).not.toContain("not licensed for business use");
    // The failing control and its auditor prose made it in.
    expect(asText(licensed)).toContain("CIS.1.13");
  });
});
