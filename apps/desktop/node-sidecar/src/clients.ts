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
import { isInvalidToken } from "./awsErrors";
import { makeCredentialProvider, type RefreshableCredentialProvider } from "./credentials";

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

/**
 * Wrap a client so a dead token is survivable.
 *
 * Dropping our own credential cache is not enough: the AWS SDK memoizes the identity it got from
 * the provider and only re-asks when it believes that identity has EXPIRED. Re-approving the
 * connection rotates the session while `expiration` is still hours away, so the SDK would keep
 * presenting a token AWS has already rejected, forever, and only restarting AgentsPoppy would
 * clear it. Rebuilding the client is what actually guarantees a fresh mint.
 *
 * Once only, and only for an invalid token: a second failure is a real one, and retrying a
 * request that AWS declined for any other reason would just double the damage.
 */
export function withTokenRecovery(build: () => AwsApi, provider: RefreshableCredentialProvider | undefined): AwsApi {
  let client = build();
  if (!provider) return client;
  return {
    async send(command: unknown): Promise<unknown> {
      try {
        return await client.send(command);
      } catch (err) {
        if (!isInvalidToken(err)) throw err;
        provider.invalidate();
        client = build();
        return await client.send(command);
      }
    },
  };
}

export function makeClients(env: SidecarEnv): Clients {
  const credentials = env.bootstrap ? makeCredentialProvider(env.bootstrap) : undefined;
  // Throttling is normal here, not exceptional: enabling walks IAM, Config and Security Hub in
  // one burst, and IAM in particular has very low request limits — the founder hit a bare "Rate
  // exceeded" on a live account (2026-09-05) with the SDK's default 3 attempts. `adaptive` adds
  // client-side rate limiting on top of backoff, which is what AWS recommends for exactly this
  // shape of workload, and a higher ceiling gives a throttled burst room to drain instead of
  // surfacing a meaningless error to someone who can do nothing about it.
  const cfg = {
    region: env.region,
    maxAttempts: 8,
    retryMode: "adaptive",
    ...(credentials ? { credentials } : {}),
  };
  const recover = (build: () => AwsApi): AwsApi => withTokenRecovery(build, credentials);
  return {
    config: recover(() => new ConfigServiceClient(cfg) as AwsApi),
    securityhub: recover(() => new SecurityHubClient(cfg) as AwsApi),
    cloudformation: recover(() => new CloudFormationClient(cfg) as AwsApi),
    s3: recover(() => new S3Client(cfg) as AwsApi),
    iam: recover(() => new IAMClient(cfg) as AwsApi),
    sts: recover(() => new STSClient(cfg) as AwsApi),
    ec2: recover(() => new EC2Client(cfg) as AwsApi),
    rds: recover(() => new RDSClient(cfg) as AwsApi),
    lambda: recover(() => new LambdaClient(cfg) as AwsApi),
    cloudtrail: recover(() => new CloudTrailClient(cfg) as AwsApi),
    dynamodb: recover(() => new DynamoDBClient(cfg) as AwsApi),
    pricing: recover(
      () => new PricingClient({ region: "us-east-1", ...(credentials ? { credentials } : {}) }) as AwsApi,
    ),
    region: env.region,
  };
}
