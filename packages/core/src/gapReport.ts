/**
 * The gap report (DESIGN §2.1): Security Hub control states → an auditor-shaped
 * report grouped by Trust Services Criteria.
 *
 * The one rule that must never break (phase-0 finding 4): while standards are
 * PENDING/INCOMPLETE and findings haven't generated, the report says "checks
 * are warming up" — it is never rendered as an empty, falsely clean report.
 */
import { findMapping, MAPPING_VERSION, TSC_META } from "./mapping";
import type {
  ControlState,
  GapControl,
  GapReport,
  RecorderState,
  StandardState,
  TscId,
} from "./types";

const TSC_ORDER: TscId[] = ["CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "A1", "C1"];

const SEVERITY_ORDER: Record<ControlState["severity"], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFORMATIONAL: 4,
};

/** FAILED first (by severity), then WARNING, NO_DATA, NOT_AVAILABLE, PASSED. */
const COMPLIANCE_ORDER: Record<ControlState["compliance"], number> = {
  FAILED: 0,
  WARNING: 1,
  NO_DATA: 2,
  NOT_AVAILABLE: 3,
  PASSED: 4,
};

export interface GapReportInput {
  accountId: string;
  region: string;
  standards: StandardState[];
  recorder: RecorderState;
  controls: ControlState[];
  now?: Date;
}

/**
 * A report is "warming up" while any enabled standard is still PENDING or
 * INCOMPLETE — Config-backed controls may still be enabling, so results are
 * partial by construction, whatever data has already arrived.
 */
export function isWarmingUp(standards: StandardState[]): boolean {
  // Even with partial data, PENDING/INCOMPLETE means more checks are coming:
  // the report stays flagged until the standards settle, so a half-empty
  // report can't read as a clean one.
  return standards.some((s) => s.status === "PENDING" || s.status === "INCOMPLETE");
}

export function buildGapReport(input: GapReportInput): GapReport {
  const groups = new Map<TscId, GapControl[]>();
  const unmapped: GapControl[] = [];
  const totals = { passed: 0, failed: 0, warning: 0, noData: 0, disabled: 0 };

  for (const c of input.controls) {
    if (!c.enabled) totals.disabled += 1;
    else if (c.compliance === "PASSED") totals.passed += 1;
    else if (c.compliance === "FAILED") totals.failed += 1;
    else if (c.compliance === "WARNING") totals.warning += 1;
    else totals.noData += 1;

    const mapping = findMapping(c.standard, c.controlId);
    const control: GapControl = {
      controlId: c.controlId,
      standard: c.standard,
      title: c.title,
      severity: c.severity,
      compliance: c.compliance,
      enabled: c.enabled,
      auditorNote: mapping?.auditorNote,
      fix: mapping?.fix,
      failedResources: c.failedResources,
    };
    if (!mapping) {
      unmapped.push(control);
      continue;
    }
    for (const tsc of mapping.tsc) {
      const list = groups.get(tsc) ?? [];
      list.push(control);
      groups.set(tsc, list);
    }
  }

  const sortControls = (list: GapControl[]): GapControl[] =>
    [...list].sort((a, b) => {
      const byCompliance = COMPLIANCE_ORDER[a.compliance] - COMPLIANCE_ORDER[b.compliance];
      if (byCompliance !== 0) return byCompliance;
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.controlId.localeCompare(b.controlId);
    });

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    accountId: input.accountId,
    region: input.region,
    warmingUp: isWarmingUp(input.standards),
    standards: input.standards,
    recorder: input.recorder,
    groups: TSC_ORDER.filter((t) => groups.has(t)).map((tsc) => ({
      tsc,
      name: TSC_META[tsc].name,
      description: TSC_META[tsc].description,
      controls: sortControls(groups.get(tsc) ?? []),
    })),
    unmapped: sortControls(unmapped),
    totals,
    mappingVersion: MAPPING_VERSION,
  };
}
