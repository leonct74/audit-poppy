/**
 * Shared vocabulary for AuditPoppy — pure types, no AWS SDK, no IO.
 *
 * Everything here mirrors what the sidecar reads live from AWS (Security Hub
 * control statuses, Config recorder state) or what the poppy itself produces
 * (the gap report, the evidence bundle, the enablement ledger). The frontend,
 * the sidecar and the snapshot Lambda all speak these shapes.
 */

/** The two Security Hub standards v1 pins (DESIGN §5). */
export type StandardId = "cis-1.2.0" | "fsbp-1.0.0";

export const STANDARD_LABELS: Record<StandardId, string> = {
  "cis-1.2.0": "CIS AWS Foundations Benchmark v1.2.0",
  "fsbp-1.0.0": "AWS Foundational Security Best Practices v1.0.0",
};

/**
 * A SOC 2 Trust Services Criteria reference the mapping table groups by.
 * v1 covers the security (common) criteria plus availability/confidentiality
 * where the AWS checks genuinely speak to them.
 */
export type TscId =
  | "CC1" // control environment
  | "CC2" // communication & information
  | "CC3" // risk assessment
  | "CC4" // monitoring activities
  | "CC5" // control activities
  | "CC6" // logical & physical access
  | "CC7" // system operations
  | "CC8" // change management
  | "CC9" // risk mitigation
  | "A1" // availability
  | "C1"; // confidentiality

/** Security Hub's per-control enablement + compliance, as the read path returns it. */
export interface ControlState {
  /** Security Hub control id, e.g. "CIS.1.1" or "IAM.4". */
  controlId: string;
  standard: StandardId;
  title: string;
  /** Whether the control is enabled in the standard subscription. */
  enabled: boolean;
  severity: "INFORMATIONAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /**
   * Compliance from findings: PASSED / FAILED / WARNING / NOT_AVAILABLE, or
   * "NO_DATA" while checks are still warming up (no finding generated yet).
   */
  compliance: "PASSED" | "FAILED" | "WARNING" | "NOT_AVAILABLE" | "NO_DATA";
  /** Resources the failing findings name (bounded; for the gap report detail). */
  failedResources?: string[];
  /**
   * Set when this result was inherited from the security control that actually carries the
   * finding (AWS reports one finding per underlying control, under its FSBP-style name). The
   * report shows it, so a derived answer is never mistaken for a check that ran under this id.
   */
  derivedFrom?: string;
}

/**
 * A standard subscription's readiness. PENDING and INCOMPLETE mean the checks
 * are still warming up (phase-0 finding 4) — the UI must NEVER render either
 * as a clean/empty report.
 */
export interface StandardState {
  standard: StandardId;
  status: "PENDING" | "READY" | "INCOMPLETE" | "FAILED" | "DELETING" | "NOT_ENABLED";
}

/** AWS Config recorder state, as the enable flow and the gap report need it. */
export interface RecorderState {
  present: boolean;
  recording: boolean;
  /** Set when the recorder exists but was NOT created by AuditPoppy. */
  preExisting?: boolean;
}

/** One entry in the mapping table: an AWS check → the TSC it evidences. */
export interface MappedCheck {
  /** Security Hub control id, e.g. "CIS.1.1" or "S3.1". */
  checkId: string;
  standard: StandardId;
  /** The criteria this check evidences (usually one, sometimes two). */
  tsc: TscId[];
  /** Why an auditor cares — the single place this prose lives (DESIGN §5). */
  auditorNote: string;
  /** The concrete AWS fix, in plain language. */
  fix: string;
}

/** The gap report, grouped by Trust Services Criteria (DESIGN §2.1). */
export interface GapReport {
  generatedAt: string;
  accountId: string;
  region: string;
  /**
   * True while standards are PENDING/INCOMPLETE and findings haven't arrived —
   * the UI shows "checks are warming up", never an empty (= falsely clean) report.
   */
  warmingUp: boolean;
  standards: StandardState[];
  recorder: RecorderState;
  groups: GapGroup[];
  /** Controls the mapping table doesn't (yet) map — still shown, flagged. */
  unmapped: GapControl[];
  totals: { passed: number; failed: number; warning: number; noData: number; disabled: number };
  mappingVersion: string;
}

export interface GapGroup {
  tsc: TscId;
  name: string;
  description: string;
  controls: GapControl[];
}

export interface GapControl {
  controlId: string;
  standard: StandardId;
  title: string;
  severity: ControlState["severity"];
  compliance: ControlState["compliance"];
  enabled: boolean;
  auditorNote?: string;
  fix?: string;
  failedResources?: string[];
  /** The security control this result was inherited from, when it was. */
  derivedFrom?: string;
}

/**
 * The enablement ledger (DESIGN §3 teardown nuance): every account-level
 * service the poppy turned on, with the pre-existing check that decides what
 * teardown may touch. "found enabled, not ours" entries are never disabled.
 */
export type LedgerService =
  | "config-recorder"
  | "config-delivery-channel"
  | "config-slr"
  | "securityhub"
  | "securityhub-slr"
  | "securityhub-standard:cis-1.2.0"
  | "securityhub-standard:fsbp-1.0.0";

export interface LedgerEntry {
  service: LedgerService;
  /** ISO time we acted (or observed, for pre-existing). */
  at: string;
  /** True = it was already on before AuditPoppy: teardown never touches it. */
  preExisting: boolean;
}

/** A monthly evidence bundle's index entry (DESIGN §2.2). */
export interface EvidenceBundleSummary {
  key: string;
  capturedAt: string;
  standards: StandardState[];
  totals: GapReport["totals"];
  sizeBytes?: number;
}

/** The full bundle the snapshot Lambda writes (posture + per-control status). */
export interface EvidenceBundle {
  schemaVersion: 1;
  capturedAt: string;
  accountId: string;
  region: string;
  standards: StandardState[];
  controls: ControlState[];
  findingCounts: Record<string, number>;
  /** Which collector wrote it (the Lambda on schedule, or an on-demand run). */
  collectedBy: "snapshot-lambda" | "on-demand";
}

/** Posture facts the policy pack prefills from (all platform-observed). */
export interface ObservedPosture {
  accountId: string;
  region: string;
  iamUserCount?: number;
  usersWithoutMfa?: number;
  /**
   * How many users the MFA check actually managed to read. Present only when it is FEWER than
   * `iamUserCount` — i.e. the scan was partial, so `usersWithoutMfa` is a floor, not a total.
   * A compliance document may not round a floor up into a fact.
   */
  mfaUsersChecked?: number;
  /**
   * Accounts the poppy is DENIED from reading, as a matter of policy rather than a fault. Every
   * install has at least one: the platform's `CannotTamperWithAgentsPoppy` guardrail denies
   * `iam:*` on AgentsPoppy's own operator user, which catches our MFA read of it. Counted apart
   * from `mfaUsersChecked` because the honest sentence differs — "excluded" is a known quantity,
   * "could not be read" is not.
   */
  mfaUsersExcluded?: number;
  /**
   * Why the MFA scan came back short, in the user's words — for a genuine FAULT only, never for
   * a policy exclusion, and NEVER a provider message. Provider messages carry ARNs, account ids
   * and console links, and this string is rendered into a document a customer gives an auditor.
   */
  mfaScanProblem?: string;
  passwordPolicy?: {
    present: boolean;
    minimumLength?: number;
    requireSymbols?: boolean;
    maxAgeDays?: number;
  };
  cloudTrailEnabled?: boolean;
  multiRegionTrail?: boolean;
  bucketCount?: number;
  observedAt: string;
}

/**
 * The two registers every rendered document keeps typographically distinct
 * (the platform dossier's discipline, DESIGN §2.4): facts the poppy observed
 * vs statements the customer typed.
 */
export type Register = "platform-observed" | "customer-entered";

export interface RegisteredValue {
  value: string;
  register: Register;
}
