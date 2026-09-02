/**
 * The read path (phase-0 finding 5, verified live): standards states from
 * GetEnabledStandards, per-control status from DescribeStandardsControls
 * (paginated, per standard subscription), compliance from ACTIVE findings
 * grouped by control. All typed SDK commands; all read-only.
 */
import {
  DescribeConfigurationRecordersCommand,
  DescribeConfigurationRecorderStatusCommand,
} from "@aws-sdk/client-config-service";
import {
  DescribeStandardsControlsCommand,
  GetEnabledStandardsCommand,
  GetFindingsCommand,
} from "@aws-sdk/client-securityhub";
import {
  buildGapReport,
  type ControlState,
  type GapReport,
  type RecorderState,
  type StandardId,
  type StandardState,
} from "@auditpoppy/core";
import { isNotFound, isNotSubscribed } from "./awsErrors";
import type { Clients } from "./clients";
import type { Ledger } from "@auditpoppy/core";
import { entryFor } from "@auditpoppy/core";

/** How we recognise the two pinned standards in their subscription ARNs. */
const STANDARD_ARN_MARKERS: Record<StandardId, string> = {
  "cis-1.2.0": "cis-aws-foundations-benchmark/v/1.2.0",
  "fsbp-1.0.0": "aws-foundational-security-best-practices/v/1.0.0",
};

export function standardIdFromArn(arn: string): StandardId | undefined {
  for (const [id, marker] of Object.entries(STANDARD_ARN_MARKERS) as [StandardId, string][]) {
    if (arn.includes(marker)) return id;
  }
  return undefined;
}

interface EnabledStandard {
  standard: StandardId;
  subscriptionArn: string;
  status: StandardState["status"];
}

interface GetEnabledStandardsOutput {
  StandardsSubscriptions?: {
    StandardsArn?: string;
    StandardsSubscriptionArn?: string;
    StandardsStatus?: string;
  }[];
  NextToken?: string;
}

export async function fetchEnabledStandards(clients: Clients): Promise<EnabledStandard[]> {
  const out: EnabledStandard[] = [];
  let NextToken: string | undefined;
  try {
    do {
      const res = (await clients.securityhub.send(
        new GetEnabledStandardsCommand({ NextToken }),
      )) as GetEnabledStandardsOutput;
      for (const sub of res.StandardsSubscriptions ?? []) {
        const id = standardIdFromArn(sub.StandardsArn ?? sub.StandardsSubscriptionArn ?? "");
        if (id && sub.StandardsSubscriptionArn) {
          out.push({
            standard: id,
            subscriptionArn: sub.StandardsSubscriptionArn,
            status: (sub.StandardsStatus as StandardState["status"]) ?? "PENDING",
          });
        }
      }
      NextToken = res.NextToken;
    } while (NextToken);
  } catch (err) {
    if (isNotSubscribed(err)) return []; // Security Hub not enabled at all
    throw err;
  }
  return out;
}

interface DescribeControlsOutput {
  Controls?: {
    ControlId?: string;
    Title?: string;
    ControlStatus?: string;
    SeverityRating?: string;
    StandardsControlArn?: string;
  }[];
  NextToken?: string;
}

interface GetFindingsOutput {
  Findings?: {
    Compliance?: { Status?: string };
    ProductFields?: Record<string, string>;
    Resources?: { Id?: string }[];
  }[];
  NextToken?: string;
}

const FINDINGS_PAGE_LIMIT = 20; // ×100 findings — bounded, plenty for two standards

/** Worst-first so one FAILED finding colours the control. */
const WORSE: Record<string, number> = { FAILED: 0, WARNING: 1, NOT_AVAILABLE: 2, PASSED: 3 };

export async function fetchControls(clients: Clients, standards: EnabledStandard[]): Promise<ControlState[]> {
  // 1. Control inventory per standard subscription.
  const controls: (ControlState & { arn: string })[] = [];
  for (const std of standards) {
    let NextToken: string | undefined;
    do {
      const res = (await clients.securityhub.send(
        new DescribeStandardsControlsCommand({ StandardsSubscriptionArn: std.subscriptionArn, NextToken }),
      )) as DescribeControlsOutput;
      for (const c of res.Controls ?? []) {
        if (!c.ControlId) continue;
        controls.push({
          arn: c.StandardsControlArn ?? "",
          controlId: c.ControlId,
          standard: std.standard,
          title: c.Title ?? c.ControlId,
          enabled: c.ControlStatus !== "DISABLED",
          severity: (c.SeverityRating as ControlState["severity"]) ?? "MEDIUM",
          compliance: "NO_DATA",
        });
      }
      NextToken = res.NextToken;
    } while (NextToken);
  }

  // 2. Compliance from ACTIVE findings, grouped by StandardsControlArn.
  const byArn = new Map(controls.map((c) => [c.arn, c]));
  let NextToken: string | undefined;
  let pages = 0;
  do {
    const res = (await clients.securityhub.send(
      new GetFindingsCommand({
        Filters: {
          RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }],
          WorkflowStatus: [
            { Value: "NEW", Comparison: "EQUALS" },
            { Value: "NOTIFIED", Comparison: "EQUALS" },
          ],
        },
        MaxResults: 100,
        NextToken,
      }),
    )) as GetFindingsOutput;
    for (const finding of res.Findings ?? []) {
      const controlArn = finding.ProductFields?.["StandardsControlArn"] ?? finding.ProductFields?.["RuleId"] ?? "";
      const control = byArn.get(controlArn);
      if (!control) continue;
      const status = finding.Compliance?.Status;
      if (!status || WORSE[status] === undefined) continue;
      if (control.compliance === "NO_DATA" || (WORSE[status] ?? 9) < (WORSE[control.compliance] ?? 9)) {
        control.compliance = status as ControlState["compliance"];
      }
      if (status === "FAILED") {
        const ids = (finding.Resources ?? []).map((r) => r.Id).filter((x): x is string => !!x);
        control.failedResources = [...new Set([...(control.failedResources ?? []), ...ids])].slice(0, 10);
      }
    }
    NextToken = res.NextToken;
    pages += 1;
  } while (NextToken && pages < FINDINGS_PAGE_LIMIT);

  return controls.map(({ arn: _arn, ...rest }) => rest);
}

interface RecordersOutput {
  ConfigurationRecorders?: { name?: string }[];
}
interface RecorderStatusOutput {
  ConfigurationRecordersStatus?: { recording?: boolean }[];
}

export async function fetchRecorderState(clients: Clients, ledger: Ledger): Promise<RecorderState> {
  try {
    const recorders = (await clients.config.send(new DescribeConfigurationRecordersCommand({}))) as RecordersOutput;
    const present = (recorders.ConfigurationRecorders ?? []).length > 0;
    if (!present) return { present: false, recording: false };
    const status = (await clients.config.send(
      new DescribeConfigurationRecorderStatusCommand({}),
    )) as RecorderStatusOutput;
    const recording = (status.ConfigurationRecordersStatus ?? []).some((s) => s.recording === true);
    const entry = entryFor(ledger, "config-recorder");
    return { present, recording, preExisting: entry ? entry.preExisting : true };
  } catch (err) {
    if (isNotFound(err)) return { present: false, recording: false };
    throw err;
  }
}

export interface ReadinessSnapshot {
  standards: StandardState[];
  controls: ControlState[];
  recorder: RecorderState;
}

export async function fetchReadiness(clients: Clients, ledger: Ledger): Promise<ReadinessSnapshot> {
  const enabled = await fetchEnabledStandards(clients);
  const standards: StandardState[] = (["cis-1.2.0", "fsbp-1.0.0"] as StandardId[]).map((id) => {
    const found = enabled.find((e) => e.standard === id);
    return { standard: id, status: found?.status ?? "NOT_ENABLED" };
  });
  const controls = enabled.length > 0 ? await fetchControls(clients, enabled) : [];
  const recorder = await fetchRecorderState(clients, ledger);
  return { standards, controls, recorder };
}

export async function buildLiveGapReport(
  clients: Clients,
  ledger: Ledger,
  accountId: string,
  region: string,
): Promise<GapReport> {
  const snap = await fetchReadiness(clients, ledger);
  return buildGapReport({
    accountId,
    region,
    standards: snap.standards,
    recorder: snap.recorder,
    controls: snap.controls,
  });
}
