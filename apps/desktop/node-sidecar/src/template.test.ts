import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permissionSet, STACK_NAME } from "./permissionSet";
import { buildTemplate, evidenceBucketName, SNAPSHOT_FN_NAME, TABLE_NAME } from "./template";

describe("the AuditPoppyStack template", () => {
  const template = buildTemplate();
  const resources = template.Resources as Record<string, { Type: string; Properties?: Record<string, unknown>; Condition?: string; DeletionPolicy?: string }>;

  it("names every resource inside the manifest's scopes — grant and template can't drift", () => {
    assert.ok(TABLE_NAME.startsWith(`${STACK_NAME}-`));
    assert.ok(SNAPSHOT_FN_NAME.startsWith(`${STACK_NAME}-`));
    assert.ok(evidenceBucketName("111122223333").startsWith("auditpoppy-"));
    const roleName = resources.SnapshotRole?.Properties?.RoleName as string;
    assert.ok(roleName.startsWith(`${STACK_NAME}-`));
    const ruleName = resources.ScheduleRule?.Properties?.Name as string;
    assert.ok(ruleName.startsWith(`${STACK_NAME}-`));
  });

  it("hardens the evidence bucket: versioned, SSE, public access blocked, TLS-only", () => {
    const bucket = resources.EvidenceBucket?.Properties as {
      VersioningConfiguration?: { Status?: string };
      BucketEncryption?: unknown;
      PublicAccessBlockConfiguration?: { BlockPublicAcls?: boolean };
    };
    assert.equal(bucket.VersioningConfiguration?.Status, "Enabled");
    assert.ok(bucket.BucketEncryption);
    assert.equal(bucket.PublicAccessBlockConfiguration?.BlockPublicAcls, true);
    const policy = JSON.stringify(resources.EvidenceBucketPolicy?.Properties);
    assert.ok(policy.includes("aws:SecureTransport"));
  });

  it("carries the three Config-delivery statements (phase-0 finding 2), account-pinned", () => {
    const statements = (
      resources.EvidenceBucketPolicy?.Properties?.PolicyDocument as { Statement: { Sid?: string }[] }
    ).Statement;
    const sids = statements.map((s) => s.Sid);
    for (const sid of ["AWSConfigBucketPermissionsCheck", "AWSConfigBucketExistenceCheck", "AWSConfigBucketDelivery"]) {
      assert.ok(sids.includes(sid), `missing ${sid}`);
    }
    const text = JSON.stringify(statements);
    assert.ok(text.includes("bucket-owner-full-control"));
    assert.ok(text.includes("AWS:SourceAccount"));
  });

  it("phase A: with no code key, only storage deploys (compute is conditional)", () => {
    for (const name of ["SnapshotRole", "SnapshotFunction", "SnapshotLogGroup", "ScheduleRule", "SchedulePermission"]) {
      assert.equal(resources[name]?.Condition, "HasLambdaCode", `${name} must be conditional`);
    }
    assert.equal(resources.EvidenceBucket?.Condition, undefined);
    assert.equal(resources.AssessmentsTable?.Condition, undefined);
  });

  it("leaves no trace: nothing is Retain-protected", () => {
    for (const [name, resource] of Object.entries(resources)) {
      assert.notEqual(resource.DeletionPolicy, "Retain", `${name} must be deletable`);
    }
  });

  it("the snapshot role only reads checks and writes its own evidence prefix", () => {
    const policies = resources.SnapshotRole?.Properties?.Policies as {
      PolicyDocument: { Statement: { Action: string | string[]; Sid?: string }[] };
    }[];
    const statements = policies[0]?.PolicyDocument.Statement ?? [];
    assert.ok(statements.length > 0);
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    for (const action of actions) {
      assert.ok(
        /^(securityhub:(Get|Describe)|config:Describe|s3:PutObject$|logs:(CreateLogStream|PutLogEvents)$)/.test(action),
        `unexpected snapshot-role action ${action}`,
      );
    }
  });

  it("the manifest's grants cover the template's IAM needs (CAPABILITY_NAMED_IAM path)", () => {
    const iamGrant = permissionSet().grants.find(
      (g) => g.service === "iam" && g.resourceScope.includes(STACK_NAME),
    );
    for (const needed of ["CreateRole", "DeleteRole", "PutRolePolicy", "DeleteRolePolicy", "PassRole", "GetRole"]) {
      assert.ok(iamGrant?.actions.includes(needed), `iam grant missing ${needed}`);
    }
  });
});
