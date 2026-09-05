/**
 * AuditPoppy's declared AWS access — the SINGLE SOURCE the extension manifest
 * is generated from (scripts/build-manifest.ts), so the approval screen and the
 * credentials the broker vends can never drift from what the code calls.
 *
 * DESIGN §4 — the first deliberately WIDE poppy, and how it stays honest:
 *   - Wide READ, explicitly enumerated: every estate read is a specific action
 *     with a `reason` in the user's words. No data-plane reads — it reads
 *     ABOUT buckets and databases, never FROM them (no s3:GetObject outside
 *     its own auditpoppy-* evidence bucket).
 *   - Narrow WRITE: its stack (AuditPoppyStack*), its bucket (auditpoppy-*),
 *     its table, and the account-level service enablement Config/Security Hub
 *     require (which AWS exposes with no per-resource handle to scope to).
 *   - NO auto-remediation, ever: there is no grant here that can change the
 *     resources the findings are about, and none may ever be added.
 *
 * Phase-0 lesson (finding 2) baked in: requests are built as typed SDK
 * objects, never interpolated strings — see clients.ts and enable.ts.
 */

export const APP = { id: "com.auditpoppy.desktop", name: "AuditPoppy" } as const;

export const APP_TAG_KEY = "agentspoppy:app";
export const CONNECTION_TAG_KEY = "agentspoppy:connection";
export const ACCOUNT_TAG_KEY = "agentspoppy:account";

/** The one CloudFormation stack (DESIGN §3 — the ONLY deployed compute). */
export const STACK_NAME = "AuditPoppyStack";
/** The evidence bucket's name prefix — the poppy's own namespace in S3. */
export const BUCKET_PREFIX = "auditpoppy-";

export interface Grant {
  service: string;
  actions: string[];
  resourceScope: string;
  reason?: string;
}

const grant = (service: string, actions: string[], resourceScope = "*", reason?: string): Grant =>
  reason ? { service, actions, resourceScope, reason } : { service, actions, resourceScope };

const stack = `arn:aws:cloudformation:*:*:stack/${STACK_NAME}/*`;
const role = `arn:aws:iam::*:role/${STACK_NAME}-*`;
const configSlr = "arn:aws:iam::*:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig*";
const securityHubSlr = "arn:aws:iam::*:role/aws-service-role/securityhub.amazonaws.com/AWSServiceRoleForSecurityHub*";
const fn = `arn:aws:lambda:*:*:function:${STACK_NAME}-*`;
const table = `arn:aws:dynamodb:*:*:table/${STACK_NAME}-*`;
const logs = `arn:aws:logs:*:*:log-group:/aws/lambda/${STACK_NAME}-*`;
const rule = `arn:aws:events:*:*:rule/${STACK_NAME}-*`;
const buckets = `arn:aws:s3:::${BUCKET_PREFIX}*`;
const objects = `arn:aws:s3:::${BUCKET_PREFIX}*/*`;
const hub = "arn:aws:securityhub:*:*:hub/default";

export function permissionSet() {
  return {
    id: "auditpoppy-backend",
    name: "AuditPoppy backend",
    description:
      "Checks your cloud account against the security checks auditors ask about, and keeps the evidence in your own account. " +
      "Its READ access is wide on purpose — reading your setup is the product — but it is read-only: it looks at how things are configured, " +
      "never at the data inside them. Everything it creates or changes is its own: one stack, one evidence bucket, one table, " +
      "plus turning on the two checking services your cloud provider offers (with your approval, costs shown first). It never changes the resources it reports on — " +
      "the gap report tells you what to fix; fixing stays in your hands.",
    grants: [
      // ---- The two AWS checking services (the write half of the product) ----
      grant("securityhub", ["EnableSecurityHub"], "*",
        "Turns on AWS Security Hub, the service that runs the security checks your report is built from — only after showing you what it costs."),
      grant("securityhub", [
        "DisableSecurityHub", "BatchEnableStandards", "BatchDisableStandards", "TagResource", "UntagResource",
      ], hub,
        "Chooses which check catalogues run (CIS and AWS foundational best practices), and turns Security Hub back off when you remove AuditPoppy — only if AuditPoppy was the one that turned it on."),
      grant("securityhub", [
        "DescribeHub", "GetEnabledStandards", "DescribeStandards", "DescribeStandardsControls", "GetFindings",
      ], "*",
        "Reads the results of the security checks — which passed, which failed, and on what — to build your gap report and evidence."),
      grant("config", [
        "PutConfigurationRecorder", "PutDeliveryChannel", "StartConfigurationRecorder",
        "StopConfigurationRecorder", "DeleteConfigurationRecorder", "DeleteDeliveryChannel",
      ], "*",
        "Turns on AWS Config, which keeps the record of configuration changes your audit evidence needs — and turns it off again when you remove AuditPoppy, only if AuditPoppy enabled it."),
      grant("config", [
        "DescribeConfigurationRecorders", "DescribeConfigurationRecorderStatus", "DescribeDeliveryChannels",
        "DescribeConfigRules", "DescribeComplianceByConfigRule", "GetComplianceDetailsByConfigRule",
        "GetDiscoveredResourceCounts",
      ], "*",
        "Reads whether change recording is on, what the recorded checks found, and how many resources your account has — the number your cost estimate is computed from."),

      // ---- Its own stack: evidence bucket + snapshot Lambda + table ----
      grant("cloudformation", [
        "CreateStack", "UpdateStack", "DeleteStack", "DescribeStacks", "DescribeStackEvents",
        "DescribeStackResources", "ListStackResources", "GetTemplate", "TagResource",
      ], stack),
      grant("cloudformation", ["ValidateTemplate", "GetTemplateSummary"], "*",
        "Before deploying, asks your cloud provider to double-check its own deployment plan, so a mistake is caught before anything is created in your account."),
      grant("iam", [
        "CreateRole", "DeleteRole", "GetRole", "TagRole", "UntagRole",
        "PutRolePolicy", "DeleteRolePolicy", "GetRolePolicy", "ListRolePolicies",
        "ListAttachedRolePolicies", "PassRole", "PutRolePermissionsBoundary", "DeleteRolePermissionsBoundary",
      ], role),
      grant("iam", ["CreateServiceLinkedRole", "DeleteServiceLinkedRole", "GetServiceLinkedRoleDeletionStatus"], configSlr,
        "AWS Config needs its own AWS-defined helper role to read your configuration; this creates exactly that role when Config is turned on, and removes it at teardown if AuditPoppy created it."),
      // PassRole on the SLR, separately from the stack roles above. Creating the role is not enough:
      // PutConfigurationRecorder HANDS that role to the Config service, and AWS checks iam:PassRole
      // on the role being handed over. Found live on 2026-09-05 — the mock has no IAM, so the smoke
      // loop enabled happily while the real call failed with "no session policy allows the
      // iam:PassRole action". Scoped to the one AWS-defined role, never to "*".
      grant("iam", ["PassRole"], configSlr,
        "Hands that AWS-defined helper role to the AWS Config service — the step that actually starts the change recording. It covers only that one role, so it cannot be used to hand over any other role in your account."),
      // Security Hub creates its OWN service-linked role as a side effect of EnableSecurityHub —
      // we never call CreateServiceLinkedRole for it, but the CALLER's session policy still has to
      // allow the creation AWS performs on our behalf. Found live on 2026-09-05, one call after
      // the Config PassRole fix: an implicit role creation is still a role creation.
      grant("iam", ["CreateServiceLinkedRole", "DeleteServiceLinkedRole", "GetServiceLinkedRoleDeletionStatus"], securityHubSlr,
        "AWS Security Hub needs its own AWS-defined helper role to read your findings; turning Security Hub on creates exactly that role, and removal deletes it again if AuditPoppy was what created it."),
      grant("lambda", [
        "CreateFunction", "DeleteFunction", "GetFunction", "GetFunctionConfiguration",
        "UpdateFunctionCode", "UpdateFunctionConfiguration", "AddPermission", "RemovePermission",
        "InvokeFunction", "TagResource", "UntagResource", "ListTags",
      ], fn),
      grant("s3", [
        "CreateBucket", "DeleteBucket", "PutBucketPolicy", "GetBucketPolicy", "DeleteBucketPolicy",
        "PutEncryptionConfiguration", "GetEncryptionConfiguration", "PutBucketPublicAccessBlock",
        "GetBucketPublicAccessBlock", "PutBucketTagging", "PutBucketVersioning", "GetBucketVersioning",
        "PutLifecycleConfiguration", "GetLifecycleConfiguration", "ListBucket", "ListBucketVersions", "HeadBucket",
      ], buckets),
      grant("s3", ["GetObject", "PutObject", "DeleteObject", "GetObjectVersion", "DeleteObjectVersion"], objects),
      grant("dynamodb", [
        "CreateTable", "DeleteTable", "DescribeTable", "TagResource", "UntagResource", "ListTagsOfResource",
        "GetItem", "PutItem", "UpdateItem", "DeleteItem", "Query", "Scan", "BatchWriteItem",
      ], table),
      grant("events", [
        "PutRule", "DeleteRule", "DescribeRule", "PutTargets", "RemoveTargets", "ListTargetsByRule",
        "TagResource", "UntagResource",
      ], rule),
      grant("logs", ["CreateLogGroup", "DeleteLogGroup", "PutRetentionPolicy", "TagResource"], logs),

      // ---- The wide READ: the estate, for the estimate + the policy pack ----
      grant("iam", ["GetAccountSummary", "GetAccountPasswordPolicy", "ListUsers", "ListMFADevices"], "*",
        "Reads how sign-in is set up — how many users, who lacks a second factor, the password rules — to pre-fill your access-control policy with the real numbers. It never creates, changes or deletes any user."),
      grant("ec2", ["DescribeInstances", "DescribeSecurityGroups", "DescribeVpcs"], "*",
        "Counts your servers and networks to estimate the monthly cost of the checking services before you turn anything on. Configuration only — never what runs inside."),
      grant("rds", ["DescribeDBInstances"], "*",
        "Counts your databases for the same cost estimate. It sees that a database exists and how it is configured — never the data in it."),
      grant("lambda", ["ListFunctions"], "*",
        "Counts your functions for the same cost estimate — names and settings only, never code or data."),
      grant("s3", ["ListAllMyBuckets"], "*",
        "Lists your storage bucket names — to count them for the cost estimate, and to find its own evidence bucket. Names only, never what is inside."),
      grant("cloudtrail", ["DescribeTrails", "GetTrailStatus"], "*",
        "Checks whether cloud activity logging is turned on, so your incident-response policy states what is actually true."),
      grant("pricing", ["GetProducts"], "*",
        "Fetches your cloud provider's current prices so every cost shown to you is live, never a stale built-in number."),
      grant("sts", ["GetCallerIdentity"], "*",
        "Checks which cloud account it is connected to, so every screen can show where it is about to work."),
    ],
    requiredTags: [ACCOUNT_TAG_KEY, APP_TAG_KEY, CONNECTION_TAG_KEY],
    limits: null,
    // Door 1: the ONLY deployed compute is the snapshot Lambda, and it talks to
    // AWS services alone. Door 2: nothing internet-facing is built for the user.
    // Door 3: the desktop half talks to AWS and the platform, nothing else —
    // declared AND host-enforced (the first poppy wearing the enforced chip,
    // DESIGN §3; the tab's platform calls are exempt by contract).
    network: { egress: "aws-only", infrastructure: "none", machine: "aws-only" },
  };
}

/** Stack-level tags (the host vends the values as transitive session tags). */
export function stackTags(connectionId: string | undefined, accountId: string | undefined): { Key: string; Value: string }[] {
  const tags: { Key: string; Value: string }[] = [{ Key: APP_TAG_KEY, Value: APP.id }];
  if (connectionId) tags.push({ Key: CONNECTION_TAG_KEY, Value: connectionId });
  if (accountId) tags.push({ Key: ACCOUNT_TAG_KEY, Value: accountId });
  return tags;
}
