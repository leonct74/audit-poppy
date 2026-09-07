/**
 * The AuditPoppyStack CloudFormation template (DESIGN §3) — the ONLY deployed
 * compute. Hand-rolled as a typed object (no CDK at runtime), deployed in two
 * phases because the Lambda's code object must exist in the bucket the same
 * stack creates:
 *
 *   phase A: CreateStack with LambdaCodeKey=""  → bucket + table only
 *   phase B: upload the code zip, UpdateStack with the real key → + Lambda,
 *            schedule rule, role, log group
 *
 * Rules honoured here:
 *  - every resource name matches the manifest's scopes (AuditPoppyStack-*,
 *    auditpoppy-*) so grant and template can never drift;
 *  - ARNs the template needs are CONSTRUCTED with Fn::Sub, never read back
 *    with a collection API (the CrewPoppy Fn::GetAtt trap);
 *  - no DeletionPolicy: Retain — teardown must be able to leave no trace;
 *  - the evidence bucket is versioned + SSE + TLS-only + public access blocked
 *    (DESIGN §6, MailPoppy's hardening list).
 */
import { BUCKET_PREFIX, STACK_NAME } from "./permissionSet";

export const TABLE_NAME = `${STACK_NAME}-assessments`;
export const SNAPSHOT_FN_NAME = `${STACK_NAME}-snapshot`;
export const SNAPSHOT_ROLE_NAME = `${STACK_NAME}-snapshot-role`;
export const SCHEDULE_RULE_NAME = `${STACK_NAME}-snapshot-monthly`;

/**
 * The evidence bucket's deterministic name for an account.
 *
 * Deterministic on purpose — every call site derives the same name without a lookup — but S3's
 * namespace is GLOBAL and its ARNs carry no account id, so this name is guessable by anyone who
 * knows the account id, and our own `arn:aws:s3:::auditpoppy-*` grant matches it in ANY account.
 * Prefer `evidenceBucketRef` for calls: see why below.
 */
export function evidenceBucketName(accountId: string): string {
  return `${BUCKET_PREFIX}evidence-${accountId}`;
}

/**
 * The bucket, PLUS the owner every S3 call must assert — spread this into the command input.
 *
 * WHY THE PAIR IS ONE VALUE. An attacker who learns the account id (cheap: it is in every ARN)
 * can pre-create `auditpoppy-evidence-<theirs-named-after-yours>` in THEIR account and allow
 * this account as a principal. Our stack then fails to create the bucket it expected to own —
 * but the READ path does not check that the stack is healthy, so `evidenceSummaries` would
 * happily parse attacker-authored JSON and carry its `capturedAt`, standards and pass/fail
 * totals into the export handed to an auditor. Fabricated evidence in the deliverable is the
 * worst outcome this product has.
 *
 * `ExpectedBucketOwner` closes it: S3 returns 403 before a byte moves when the bucket is not
 * owned by this account. It is one field, and the whole bug is forgetting it at one call site —
 * so the name and the owner are returned together and spread together, and a call site cannot
 * take one without the other.
 */
export interface EvidenceBucketRef {
  Bucket: string;
  ExpectedBucketOwner: string;
}

export function evidenceBucketRef(accountId: string): EvidenceBucketRef {
  return { Bucket: evidenceBucketName(accountId), ExpectedBucketOwner: accountId };
}

/** Monthly, 03:10 UTC on the 1st — quiet hours, well clear of DST edges. */
export const SNAPSHOT_SCHEDULE = "cron(10 3 1 * ? *)";

export function buildTemplate(): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "AuditPoppy evidence stack: versioned evidence bucket, monthly snapshot Lambda, assessments table. Audit evidence stays in this account.",
    Parameters: {
      EvidenceBucketName: { Type: "String", Description: "Name for the evidence bucket (auditpoppy-evidence-<account>)." },
      LambdaCodeKey: {
        Type: "String",
        Default: "",
        Description: "S3 key of the snapshot Lambda bundle inside the evidence bucket. Empty on the first deploy phase.",
      },
      PermissionsBoundaryArn: {
        Type: "String",
        Default: "",
        Description: "Optional AgentsPoppy permissions boundary applied to the stack's role.",
      },
      ScheduleExpression: { Type: "String", Default: SNAPSHOT_SCHEDULE },
    },
    Conditions: {
      HasLambdaCode: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "LambdaCodeKey" }, ""] }] },
      HasBoundary: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "PermissionsBoundaryArn" }, ""] }] },
    },
    Resources: {
      EvidenceBucket: {
        Type: "AWS::S3::Bucket",
        Properties: {
          BucketName: { Ref: "EvidenceBucketName" },
          VersioningConfiguration: { Status: "Enabled" },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
      EvidenceBucketPolicy: {
        Type: "AWS::S3::BucketPolicy",
        Properties: {
          Bucket: { Ref: "EvidenceBucket" },
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "DenyInsecureTransport",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: [
                  { "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}" },
                  { "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}/*" },
                ],
                Condition: { Bool: { "aws:SecureTransport": "false" } },
              },
              // The three statements AWS Config's delivery channel requires
              // (phase-0 finding 2 — verified live; without them the enable
              // flow dies on InsufficientDeliveryPolicyException). All pinned
              // to this account so no other account's Config can write here.
              {
                Sid: "AWSConfigBucketPermissionsCheck",
                Effect: "Allow",
                Principal: { Service: "config.amazonaws.com" },
                Action: "s3:GetBucketAcl",
                Resource: { "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}" },
                Condition: { StringEquals: { "AWS:SourceAccount": { Ref: "AWS::AccountId" } } },
              },
              {
                Sid: "AWSConfigBucketExistenceCheck",
                Effect: "Allow",
                Principal: { Service: "config.amazonaws.com" },
                Action: "s3:ListBucket",
                Resource: { "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}" },
                Condition: { StringEquals: { "AWS:SourceAccount": { Ref: "AWS::AccountId" } } },
              },
              {
                Sid: "AWSConfigBucketDelivery",
                Effect: "Allow",
                Principal: { Service: "config.amazonaws.com" },
                Action: "s3:PutObject",
                Resource: {
                  "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}/config/AWSLogs/${AWS::AccountId}/Config/*",
                },
                Condition: {
                  StringEquals: {
                    "s3:x-amz-acl": "bucket-owner-full-control",
                    "AWS:SourceAccount": { Ref: "AWS::AccountId" },
                  },
                },
              },
            ],
          },
        },
      },
      AssessmentsTable: {
        Type: "AWS::DynamoDB::Table",
        Properties: {
          TableName: TABLE_NAME,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "pk", AttributeType: "S" },
            { AttributeName: "sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "pk", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
        },
      },
      SnapshotRole: {
        Type: "AWS::IAM::Role",
        Condition: "HasLambdaCode",
        Properties: {
          RoleName: SNAPSHOT_ROLE_NAME,
          PermissionsBoundary: {
            "Fn::If": ["HasBoundary", { Ref: "PermissionsBoundaryArn" }, { Ref: "AWS::NoValue" }],
          },
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
          },
          Policies: [
            {
              PolicyName: "auditpoppy-snapshot",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "ReadCheckResults",
                    Effect: "Allow",
                    Action: [
                      "securityhub:GetFindings",
                      "securityhub:GetEnabledStandards",
                      "securityhub:DescribeStandards",
                      "securityhub:DescribeStandardsControls",
                      "config:DescribeConfigurationRecorderStatus",
                    ],
                    Resource: "*",
                  },
                  {
                    Sid: "WriteEvidence",
                    Effect: "Allow",
                    Action: ["s3:PutObject"],
                    Resource: { "Fn::Sub": "arn:${AWS::Partition}:s3:::${EvidenceBucketName}/evidence/*" },
                  },
                  {
                    Sid: "Logs",
                    Effect: "Allow",
                    Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                    Resource: {
                      "Fn::Sub": `arn:\${AWS::Partition}:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/${SNAPSHOT_FN_NAME}:*`,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      SnapshotLogGroup: {
        Type: "AWS::Logs::LogGroup",
        Condition: "HasLambdaCode",
        Properties: {
          LogGroupName: `/aws/lambda/${SNAPSHOT_FN_NAME}`,
          RetentionInDays: 90,
        },
      },
      SnapshotFunction: {
        Type: "AWS::Lambda::Function",
        Condition: "HasLambdaCode",
        DependsOn: ["SnapshotLogGroup"],
        Properties: {
          FunctionName: SNAPSHOT_FN_NAME,
          Runtime: "nodejs22.x",
          Handler: "snapshot.handler",
          Timeout: 120,
          MemorySize: 256,
          Code: { S3Bucket: { Ref: "EvidenceBucketName" }, S3Key: { Ref: "LambdaCodeKey" } },
          // Constructed, not read back (no Fn::GetAtt on collections).
          Role: { "Fn::GetAtt": ["SnapshotRole", "Arn"] },
          Environment: {
            Variables: {
              EVIDENCE_BUCKET: { Ref: "EvidenceBucketName" },
              AWS_ACCOUNT_ID: { Ref: "AWS::AccountId" },
            },
          },
        },
      },
      ScheduleRule: {
        Type: "AWS::Events::Rule",
        Condition: "HasLambdaCode",
        Properties: {
          Name: SCHEDULE_RULE_NAME,
          Description: "AuditPoppy monthly evidence snapshot",
          ScheduleExpression: { Ref: "ScheduleExpression" },
          State: "ENABLED",
          Targets: [{ Id: "snapshot", Arn: { "Fn::GetAtt": ["SnapshotFunction", "Arn"] } }],
        },
      },
      SchedulePermission: {
        Type: "AWS::Lambda::Permission",
        Condition: "HasLambdaCode",
        Properties: {
          FunctionName: { Ref: "SnapshotFunction" },
          Action: "lambda:InvokeFunction",
          Principal: "events.amazonaws.com",
          SourceArn: { "Fn::GetAtt": ["ScheduleRule", "Arn"] },
        },
      },
    },
    Outputs: {
      EvidenceBucket: { Value: { Ref: "EvidenceBucket" } },
      AssessmentsTable: { Value: { Ref: "AssessmentsTable" } },
    },
  };
}
