/**
 * Typed AWS SDK clients on the brokered credentials. Requests are built as
 * typed SDK command objects EVERYWHERE — never string-interpolated payloads
 * (phase-0 finding 2: a shell-built ARN cost 40 minutes; the typed SDK makes
 * that class of corruption impossible).
 *
 * In container mode every client uses the host-minted, scoped, auto-rotating
 * credentials. In developer mode (no bootstrap) the SDK default chain applies
 * (AWS_PROFILE) — the phase-0 sandbox loop, never the shipped path.
 */
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { ConfigServiceClient } from "@aws-sdk/client-config-service";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EC2Client } from "@aws-sdk/client-ec2";
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { PricingClient } from "@aws-sdk/client-pricing";
import { RDSClient } from "@aws-sdk/client-rds";
import { S3Client } from "@aws-sdk/client-s3";
import { SecurityHubClient } from "@aws-sdk/client-securityhub";
import { STSClient } from "@aws-sdk/client-sts";
import type { SidecarEnv } from "./bootstrap";
import { makeCredentialProvider } from "./credentials";

/** The structural seam the flows are written (and tested) against. */
export interface AwsApi {
  send(command: unknown): Promise<unknown>;
}

export interface Clients {
  config: AwsApi;
  securityhub: AwsApi;
  cloudformation: AwsApi;
  s3: AwsApi;
  iam: AwsApi;
  sts: AwsApi;
  ec2: AwsApi;
  rds: AwsApi;
  lambda: AwsApi;
  cloudtrail: AwsApi;
  dynamodb: AwsApi;
  /** Price List API lives in us-east-1/eu-central-1 regardless of work region. */
  pricing: AwsApi;
  region: string;
}

export function makeClients(env: SidecarEnv): Clients {
  const credentials = env.bootstrap ? makeCredentialProvider(env.bootstrap) : undefined;
  const cfg = { region: env.region, ...(credentials ? { credentials } : {}) };
  return {
    config: new ConfigServiceClient(cfg) as AwsApi,
    securityhub: new SecurityHubClient(cfg) as AwsApi,
    cloudformation: new CloudFormationClient(cfg) as AwsApi,
    s3: new S3Client(cfg) as AwsApi,
    iam: new IAMClient(cfg) as AwsApi,
    sts: new STSClient(cfg) as AwsApi,
    ec2: new EC2Client(cfg) as AwsApi,
    rds: new RDSClient(cfg) as AwsApi,
    lambda: new LambdaClient(cfg) as AwsApi,
    cloudtrail: new CloudTrailClient(cfg) as AwsApi,
    dynamodb: new DynamoDBClient(cfg) as AwsApi,
    pricing: new PricingClient({ region: "us-east-1", ...(credentials ? { credentials } : {}) }) as AwsApi,
    region: env.region,
  };
}
