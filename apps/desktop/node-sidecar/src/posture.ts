/**
 * The wide READ, at work (DESIGN §4): enumerated estate reads that feed the
 * cost estimate (resource counts, BEFORE anything is enabled) and the policy
 * pack's platform-observed prefills. Configuration only — never data.
 */
import { DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { GetDiscoveredResourceCountsCommand } from "@aws-sdk/client-config-service";
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import { GetAccountPasswordPolicyCommand, ListMFADevicesCommand, ListUsersCommand } from "@aws-sdk/client-iam";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import type { ObservedPosture } from "@auditpoppy/core";
import { errorMessage, isNotFound, isThrottled } from "./awsErrors";
import type { Clients } from "./clients";

interface CountsOutput {
  totalDiscoveredResources?: number;
}

/**
 * Best estimate of how many resources Config would record. Once Config is on,
 * its own count is authoritative; before that, we count the services that
 * dominate small accounts.
 */
export async function estimateResourceCount(clients: Clients): Promise<number> {
  try {
    const counts = (await clients.config.send(new GetDiscoveredResourceCountsCommand({}))) as CountsOutput;
    if ((counts.totalDiscoveredResources ?? 0) > 0) return counts.totalDiscoveredResources ?? 0;
  } catch {
    /* Config not on yet — fall through to the describe-based estimate */
  }

  let total = 0;
  const add = async (fn: () => Promise<number>): Promise<void> => {
    try {
      total += await fn();
    } catch {
      /* a service we can't read counts as zero, never as a failure */
    }
  };
  await add(async () => {
    const res = (await clients.ec2.send(new DescribeInstancesCommand({ MaxResults: 1000 }))) as {
      Reservations?: { Instances?: unknown[] }[];
    };
    return (res.Reservations ?? []).reduce((n, r) => n + (r.Instances?.length ?? 0), 0);
  });
  await add(async () => {
    const res = (await clients.ec2.send(new DescribeSecurityGroupsCommand({ MaxResults: 1000 }))) as {
      SecurityGroups?: unknown[];
    };
    return res.SecurityGroups?.length ?? 0;
  });
  await add(async () => {
    const res = (await clients.ec2.send(new DescribeVpcsCommand({}))) as { Vpcs?: unknown[] };
    return res.Vpcs?.length ?? 0;
  });
  await add(async () => {
    const res = (await clients.rds.send(new DescribeDBInstancesCommand({}))) as { DBInstances?: unknown[] };
    return res.DBInstances?.length ?? 0;
  });
  await add(async () => {
    const res = (await clients.lambda.send(new ListFunctionsCommand({ MaxItems: 1000 }))) as { Functions?: unknown[] };
    return res.Functions?.length ?? 0;
  });
  await add(async () => {
    const res = (await clients.s3.send(new ListBucketsCommand({}))) as { Buckets?: unknown[] };
    return res.Buckets?.length ?? 0;
  });
  await add(async () => {
    const res = (await clients.iam.send(new ListUsersCommand({ MaxItems: 200 }))) as { Users?: unknown[] };
    return res.Users?.length ?? 0;
  });
  // Roles, policies, subnets, route tables etc. multiply the visible estate —
  // stated in the estimate's detail line as an approximation, never as exact.
  return Math.max(total * 3, 20);
}

const MAX_USERS_FOR_MFA_SCAN = 200;

interface UsersOutput {
  Users?: { UserName?: string; PasswordLastUsed?: Date }[];
}
interface MfaOutput {
  MFADevices?: unknown[];
}
interface PasswordPolicyOutput {
  PasswordPolicy?: {
    MinimumPasswordLength?: number;
    RequireSymbols?: boolean;
    MaxPasswordAge?: number;
  };
}
interface TrailsOutput {
  trailList?: { Name?: string; IsMultiRegionTrail?: boolean; TrailARN?: string }[];
}
interface TrailStatusOutput {
  IsLogging?: boolean;
}

export async function observePosture(clients: Clients, accountId: string, region: string): Promise<ObservedPosture> {
  const posture: ObservedPosture = {
    accountId,
    region,
    observedAt: new Date().toISOString(),
  };

  // The MFA scan is one call PER USER, so it is the most failure-prone read in here — a live
  // account throttles IAM where a mock never will. It used to sit in a single try with the user
  // count, which meant one failing user threw away every user already counted and left the
  // document saying nothing about MFA at all, with no way to find out why. Seen live on
  // 2026-09-07: 11 users listed, MFA "not yet observed".
  //
  // So: count each user separately, keep what was learned, and record how many were actually
  // read. A partial scan gives a FLOOR ("at least N of the M we could check"), never a total —
  // rounding a floor up into a fact is the one mistake worth engineering against in a document
  // an auditor reads.
  let users: { UserName?: string }[] = [];
  try {
    users = ((await clients.iam.send(new ListUsersCommand({ MaxItems: MAX_USERS_FOR_MFA_SCAN }))) as UsersOutput).Users ?? [];
    posture.iamUserCount = users.length;
  } catch (err) {
    posture.mfaScanProblem = `The list of user accounts could not be read (${errorMessage(err)}).`;
  }

  if (posture.iamUserCount !== undefined) {
    let withoutMfa = 0;
    let checked = 0;
    let lastProblem: string | undefined;
    for (const user of users) {
      if (!user.UserName) continue;
      try {
        const mfa = (await clients.iam.send(new ListMFADevicesCommand({ UserName: user.UserName }))) as MfaOutput;
        if ((mfa.MFADevices ?? []).length === 0) withoutMfa += 1;
        checked += 1;
      } catch (err) {
        // Never name the user: this string reaches a document, and a user name is exactly the
        // kind of identifying detail that has no business being in one.
        lastProblem = isThrottled(err)
          ? "Your cloud provider limited how fast we could check each account."
          : errorMessage(err);
      }
    }
    if (checked > 0) posture.usersWithoutMfa = withoutMfa;
    if (checked < users.length) {
      posture.mfaUsersChecked = checked;
      posture.mfaScanProblem = `Multi-factor authentication could only be checked for ${checked} of ${users.length} accounts.${lastProblem ? ` ${lastProblem}` : ""}`;
    }
  }

  try {
    const policy = (await clients.iam.send(new GetAccountPasswordPolicyCommand({}))) as PasswordPolicyOutput;
    posture.passwordPolicy = {
      present: true,
      minimumLength: policy.PasswordPolicy?.MinimumPasswordLength,
      requireSymbols: policy.PasswordPolicy?.RequireSymbols,
      maxAgeDays: policy.PasswordPolicy?.MaxPasswordAge,
    };
  } catch (err) {
    if (isNotFound(err)) posture.passwordPolicy = { present: false };
  }

  try {
    const trails = ((await clients.cloudtrail.send(new DescribeTrailsCommand({}))) as TrailsOutput).trailList ?? [];
    let logging = false;
    let multiRegion = false;
    for (const trail of trails) {
      if (!trail.Name && !trail.TrailARN) continue;
      const status = (await clients.cloudtrail.send(
        new GetTrailStatusCommand({ Name: trail.TrailARN ?? trail.Name }),
      )) as TrailStatusOutput;
      if (status.IsLogging) {
        logging = true;
        if (trail.IsMultiRegionTrail) multiRegion = true;
      }
    }
    posture.cloudTrailEnabled = logging;
    posture.multiRegionTrail = multiRegion;
  } catch {
    /* leave undefined */
  }

  try {
    const res = (await clients.s3.send(new ListBucketsCommand({}))) as { Buckets?: unknown[] };
    posture.bucketCount = res.Buckets?.length ?? 0;
  } catch {
    /* leave undefined */
  }

  return posture;
}
