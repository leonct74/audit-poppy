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
import { entryFor, inheritFindings } from "@auditpoppy/core";

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
    Compliance?: { Status?: string; SecurityControlId?: string };
    ProductFields?: Record<string, string>;
    GeneratorId?: string;
    Resources?: { Id?: string }[];
  }[];
  NextToken?: string;
}

/**
 * Which control a finding is about — across every shape Security Hub has used.
 *
 * The read path originally matched ONLY `ProductFields.StandardsControlArn`. Since AWS turned on
 * consolidated control findings, a finding instead carries `Compliance.SecurityControlId` (the
 * FSBP-style id, "IAM.4", even when the finding also belongs to CIS) and a `GeneratorId` of the
 * form ".../v/1.2.0/1.12" or "security-control/IAM.4". On an account with consolidated findings
 * the old lookup matched nothing at all — which is exactly what a live run showed: 388 controls,
 * every one "awaiting data", no passes and no failures, a full day after enabling.
 *
 * So collect every key a finding offers and try them all; a control is looked up by its ARN AND
 * by its id.
 */
function findingKeys(f: NonNullable<GetFindingsOutput["Findings"]>[number]): string[] {
  const keys: string[] = [];
  const arn = f.ProductFields?.["StandardsControlArn"];
  if (arn) keys.push(arn);
  const ruleId = f.ProductFields?.["RuleId"];
  if (ruleId) keys.push(ruleId);
  const securityControlId = f.Compliance?.SecurityControlId;
  if (securityControlId) keys.push(securityControlId);
  const controlId = f.ProductFields?.["ControlId"];
  if (controlId) keys.push(controlId);
  // GeneratorId's last segment is the control id in every generator format AWS uses.
  const gen = f.GeneratorId;
  if (gen) {
    keys.push(gen);
    const tail = gen.split("/").pop();
    if (tail) keys.push(tail);
  }
  return keys;
}

const FINDINGS_PAGE_LIMIT = 20; // ×100 findings — bounded, plenty for two standards

/** Worst-first so one FAILED finding colours the control. */
const WORSE: Record<string, number> = { FAILED: 0, WARNING: 1, NOT_AVAILABLE: 2, PASSED: 3 };

export interface ControlsResult {
  controls: ControlState[];
  /** How many ACTIVE findings we read, and how many we could attribute to a control.
   *  seen > 0 with matched === 0 means the read path is broken, not that checks are warming up. */
  findingsSeen: number;
  findingsMatched: number;
}

export async function fetchControls(clients: Clients, standards: EnabledStandard[]): Promise<ControlsResult> {
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

  // 2. Compliance from ACTIVE findings. Indexed by ARN *and* by control id, because which one
  //    a finding carries depends on whether the account uses consolidated control findings.
  const byKey = new Map<string, (typeof controls)[number]>();
  for (const c of controls) {
    if (c.arn) byKey.set(c.arn, c);
    byKey.set(c.controlId, c);
  }
  let seen = 0;
  let matched = 0;
  let NextToken: string | undefined;
  let pages = 0;
  do {
    const res = (await clients.securityhub.send(
      new GetFindingsCommand({
        // ACTIVE only — nothing more. The filter used to also demand WorkflowStatus NEW or
        // NOTIFIED, which silently threw away every PASSING control: Security Hub marks a
        // finding RESOLVED when the control starts passing. A gap report that structurally
        // cannot show a pass is worse than useless — it reads as "nothing is working".
        Filters: { RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }] },
        MaxResults: 100,
        NextToken,
      }),
    )) as GetFindingsOutput;
    for (const finding of res.Findings ?? []) {
      seen += 1;
      let control: (typeof controls)[number] | undefined;
      for (const key of findingKeys(finding)) {
        control = byKey.get(key);
        if (control) break;
      }
      if (!control) continue;
      matched += 1;
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

  // A total mismatch is NOT the same as "no findings yet", and the UI could not tell them
  // apart — both rendered as "awaiting data". Say so in the log where a support answer can
  // find it: findings arriving that match nothing means the read path, not the warm-up.
  if (seen > 0 && matched === 0) {
    console.warn(
      `[readiness] read ${seen} findings but matched none to a control — the finding shape is not one this build recognises`,
    );
  }
  // AWS reports one finding per underlying security control, under its FSBP-style name, so the
  // CIS view of the same check arrives empty. Fill those in from their pair before anyone sees
  // the list — every consumer (report, export, snapshot) then reads the same filled-in set.
  const filled = inheritFindings(controls.map(({ arn: _arn, ...rest }) => rest));
  return { controls: filled, findingsSeen: seen, findingsMatched: matched };
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
  /** Diagnostic, surfaced so "we cannot read your findings" never masquerades as "warming up". */
  findingsSeen?: number;
  findingsMatched?: number;
}

export async function fetchReadiness(clients: Clients, ledger: Ledger): Promise<ReadinessSnapshot> {
  const enabled = await fetchEnabledStandards(clients);
  const standards: StandardState[] = (["cis-1.2.0", "fsbp-1.0.0"] as StandardId[]).map((id) => {
    const found = enabled.find((e) => e.standard === id);
    return { standard: id, status: found?.status ?? "NOT_ENABLED" };
  });
  const result = enabled.length > 0
    ? await fetchControls(clients, enabled)
    : { controls: [], findingsSeen: 0, findingsMatched: 0 };
  const recorder = await fetchRecorderState(clients, ledger);
  return {
    standards,
    controls: result.controls,
    recorder,
    findingsSeen: result.findingsSeen,
    findingsMatched: result.findingsMatched,
  };
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
