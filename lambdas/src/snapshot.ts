/**
 * The snapshot Lambda — THE evidence collector (DESIGN §2.2; Audit Manager is
 * closed to new accounts, phase-0 finding 1). Runs monthly on the EventBridge
 * schedule: reads the current posture from Security Hub (+ the Config recorder
 * status), and writes a dated, immutable JSON bundle into the customer's OWN
 * versioned evidence bucket. It talks to AWS services and nothing else —
 * `network.egress: "aws-only"`, and the bundle never leaves the account.
 *
 * Kept dependency-light: the AWS SDK v3 clients here are provided by the
 * nodejs22.x runtime; esbuild bundles this file alone into the deploy zip.
 */
import {
  ConfigServiceClient,
  DescribeConfigurationRecorderStatusCommand,
} from "@aws-sdk/client-config-service";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DescribeStandardsControlsCommand,
  GetEnabledStandardsCommand,
  GetFindingsCommand,
  SecurityHubClient,
} from "@aws-sdk/client-securityhub";

const securityhub = new SecurityHubClient({});
const config = new ConfigServiceClient({});
const s3 = new S3Client({});

const STANDARD_MARKERS: Record<string, string> = {
  "cis-1.2.0": "cis-aws-foundations-benchmark/v/1.2.0",
  "fsbp-1.0.0": "aws-foundational-security-best-practices/v/1.0.0",
};

interface ControlRecord {
  controlId: string;
  standard: string;
  title: string;
  enabled: boolean;
  severity: string;
  compliance: string;
}

const WORSE: Record<string, number> = { FAILED: 0, WARNING: 1, NOT_AVAILABLE: 2, PASSED: 3 };

export async function handler(): Promise<{ ok: boolean; key?: string }> {
  const bucket = process.env.EVIDENCE_BUCKET;
  if (!bucket) throw new Error("EVIDENCE_BUCKET is not set");
  // Assert the owner on the write. The bucket name is derived from the account id, and S3's
  // namespace is global — so without this, a bucket of that name pre-created in someone ELSE's
  // account would silently receive this account's evidence. The template already injects
  // AWS_ACCOUNT_ID for the bundle body; it does double duty here.
  const expectedOwner = process.env.AWS_ACCOUNT_ID;
  if (!expectedOwner) throw new Error("AWS_ACCOUNT_ID is not set");
  const capturedAt = new Date();

  // 1. Standards + their subscription state.
  const subs: { standard: string; arn: string; status: string }[] = [];
  let token: string | undefined;
  do {
    const res = await securityhub.send(new GetEnabledStandardsCommand({ NextToken: token }));
    for (const sub of res.StandardsSubscriptions ?? []) {
      const std = Object.entries(STANDARD_MARKERS).find(([, marker]) =>
        (sub.StandardsArn ?? "").includes(marker),
      )?.[0];
      if (std && sub.StandardsSubscriptionArn) {
        subs.push({ standard: std, arn: sub.StandardsSubscriptionArn, status: sub.StandardsStatus ?? "PENDING" });
      }
    }
    token = res.NextToken;
  } while (token);

  // 2. Controls per subscription.
  const controls = new Map<string, ControlRecord>();
  for (const sub of subs) {
    let next: string | undefined;
    do {
      const res = await securityhub.send(
        new DescribeStandardsControlsCommand({ StandardsSubscriptionArn: sub.arn, NextToken: next }),
      );
      for (const c of res.Controls ?? []) {
        if (!c.ControlId || !c.StandardsControlArn) continue;
        controls.set(c.StandardsControlArn, {
          controlId: c.ControlId,
          standard: sub.standard,
          title: c.Title ?? c.ControlId,
          enabled: c.ControlStatus !== "DISABLED",
          severity: c.SeverityRating ?? "MEDIUM",
          compliance: "NO_DATA",
        });
      }
      next = res.NextToken;
    } while (next);
  }

  // 3. Compliance from ACTIVE findings (bounded pages).
  let findingsToken: string | undefined;
  let pages = 0;
  const findingCounts: Record<string, number> = {};
  do {
    const res = await securityhub.send(
      new GetFindingsCommand({
        Filters: {
          RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }],
          WorkflowStatus: [
            { Value: "NEW", Comparison: "EQUALS" },
            { Value: "NOTIFIED", Comparison: "EQUALS" },
          ],
        },
        MaxResults: 100,
        NextToken: findingsToken,
      }),
    );
    for (const finding of res.Findings ?? []) {
      const status = finding.Compliance?.Status;
      if (!status) continue;
      findingCounts[status] = (findingCounts[status] ?? 0) + 1;
      const arn = finding.ProductFields?.StandardsControlArn ?? "";
      const control = controls.get(arn);
      if (control && (control.compliance === "NO_DATA" || (WORSE[status] ?? 9) < (WORSE[control.compliance] ?? 9))) {
        control.compliance = status;
      }
    }
    findingsToken = res.NextToken;
    pages += 1;
  } while (findingsToken && pages < 20);

  // 4. Recorder status (is the change record still running?).
  let recording = false;
  try {
    const rec = await config.send(new DescribeConfigurationRecorderStatusCommand({}));
    recording = (rec.ConfigurationRecordersStatus ?? []).some((s) => s.recording === true);
  } catch {
    /* Config off — recorded as such */
  }

  // 5. The bundle, dated and immutable (the bucket is versioned).
  const iso = capturedAt.toISOString();
  const key = `evidence/${iso.slice(0, 4)}/${iso.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z")}.json`;
  const bundle = {
    schemaVersion: 1,
    capturedAt: iso,
    accountId: expectedOwner,
    region: process.env.AWS_REGION ?? "",
    standards: subs.map((s) => ({ standard: s.standard, status: s.status })),
    controls: [...controls.values()],
    findingCounts,
    recorderRecording: recording,
    collectedBy: "snapshot-lambda",
  };
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      ExpectedBucketOwner: expectedOwner,
      Key: key,
      Body: JSON.stringify(bundle),
      ContentType: "application/json",
    }),
  );
  return { ok: true, key };
}
