/**
 * AuditPoppyStack deploy — the two-phase dance the template documents, made
 * background-resumable (AGENTS.md §5): every step is derived from LIVE state
 * (DescribeStacks + the code object's existence), never from memory, so the
 * user can leave mid-deploy and the flow picks up where AWS actually is.
 */
import {
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { CODE_PREFIX } from "@auditpoppy/core";
import { isNotFound } from "./awsErrors";
import type { Clients } from "./clients";
import { STACK_NAME, stackTags } from "./permissionSet";
import { buildTemplate, evidenceBucketName, evidenceBucketRef } from "./template";

export interface StackState {
  status:
    | "ABSENT"
    | "CREATING"
    | "STORAGE_READY" // phase A complete, Lambda not yet deployed
    | "UPDATING"
    | "COMPLETE" // phase B complete — full stack live
    | "DELETING"
    | "FAILED";
  rawStatus?: string;
  lambdaCodeKey?: string;
  evidenceBucket?: string;
  statusReason?: string;
}

interface DescribeStacksOutput {
  Stacks?: {
    StackStatus?: string;
    StackStatusReason?: string;
    Parameters?: { ParameterKey?: string; ParameterValue?: string }[];
    Outputs?: { OutputKey?: string; OutputValue?: string }[];
  }[];
}

export async function getStackState(clients: Clients): Promise<StackState> {
  let res: DescribeStacksOutput;
  try {
    res = (await clients.cloudformation.send(new DescribeStacksCommand({ StackName: STACK_NAME }))) as DescribeStacksOutput;
  } catch (err) {
    if (isNotFound(err)) return { status: "ABSENT" };
    throw err;
  }
  const stack = res.Stacks?.[0];
  if (!stack) return { status: "ABSENT" };
  const raw = stack.StackStatus ?? "";
  const codeKey = stack.Parameters?.find((p) => p.ParameterKey === "LambdaCodeKey")?.ParameterValue ?? "";
  const bucket = stack.Outputs?.find((o) => o.OutputKey === "EvidenceBucket")?.OutputValue;
  const base = { rawStatus: raw, lambdaCodeKey: codeKey, evidenceBucket: bucket, statusReason: stack.StackStatusReason };

  if (raw.endsWith("_IN_PROGRESS")) {
    if (raw.startsWith("DELETE")) return { status: "DELETING", ...base };
    return { status: raw.startsWith("CREATE") ? "CREATING" : "UPDATING", ...base };
  }
  if (raw === "CREATE_COMPLETE" || raw === "UPDATE_COMPLETE") {
    return { status: codeKey === "" ? "STORAGE_READY" : "COMPLETE", ...base };
  }
  return { status: "FAILED", ...base };
}

export interface DeployInput {
  accountId: string;
  connectionId?: string;
  permissionsBoundaryArn?: string;
  /** The bundled snapshot Lambda: content-addressed key + bytes. */
  lambdaCodeKey: string;
  lambdaZip: Buffer;
}

/**
 * Advance the deploy by ONE step from live state, returning the state after
 * the step was issued. The frontend polls; each poll advances at most one
 * phase, so an interrupted deploy resumes exactly where AWS is.
 */
export async function advanceDeploy(clients: Clients, input: DeployInput): Promise<StackState> {
  const state = await getStackState(clients);

  // A create that failed and rolled back leaves a stack holding NOTHING, and AWS will not let
  // the name be reused until it is deleted. So delete it — but CARRY THE REASON OUT FIRST, and
  // then STOP.
  //
  // The first version of this deleted and returned live state, which let the caller create again
  // on the very next poll. That is an unbounded retry: create → roll back → delete → create,
  // every few seconds, showing "Creating…" the whole time, and it erases the one thing that
  // explains the failure — CloudFormation's rollback reason dies with the stack. A loop that
  // hides its own cause is worse than the failure it is retrying past.
  //
  // Now: one delete, then FAILED carrying the reason, and the retry is a button press. One press
  // is one attempt, and the person can see what went wrong between them.
  //
  // DELETE_FAILED is deliberately NOT handled here, though it looks like the same shape. It
  // means a previous REMOVAL got part-way, and nothing in this template is DeletionPolicy:
  // Retain — that is on purpose, so teardown can leave no trace. Finishing that delete could
  // therefore destroy a customer's evidence bucket, and a button labelled "set up evidence
  // collection" must never do that. It is a removal decision, so it belongs behind the removal
  // screen's export gate and type-to-confirm; the Evidence screen says so instead of offering a
  // retry that silently does nothing (which is what the founder hit on 2026-09-07).
  if (state.rawStatus === "ROLLBACK_COMPLETE") {
    const reason = state.statusReason;
    await deleteStack(clients);
    return {
      status: "FAILED",
      rawStatus: "ROLLBACK_COMPLETE",
      statusReason: reason
        ? `Setting up failed and was rolled back: ${reason}. The half-made stack has been cleared, so you can try again.`
        : "Setting up failed and was rolled back. The half-made stack has been cleared, so you can try again.",
    };
  }

  const bucket = evidenceBucketName(input.accountId);
  const tags = stackTags(input.connectionId, input.accountId);
  const templateBody = JSON.stringify(buildTemplate());

  if (state.status === "ABSENT") {
    await clients.cloudformation.send(
      new CreateStackCommand({
        StackName: STACK_NAME,
        TemplateBody: templateBody,
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        Parameters: [
          { ParameterKey: "EvidenceBucketName", ParameterValue: bucket },
          { ParameterKey: "LambdaCodeKey", ParameterValue: "" },
          { ParameterKey: "PermissionsBoundaryArn", ParameterValue: input.permissionsBoundaryArn ?? "" },
        ],
        Tags: tags,
      }),
    );
    return await getStackState(clients);
  }

  if (state.status === "STORAGE_READY") {
    const key = `${CODE_PREFIX}${input.lambdaCodeKey}`;
    await clients.s3.send(
      new PutObjectCommand({
        ...evidenceBucketRef(input.accountId),
        Key: key,
        Body: input.lambdaZip,
        ContentType: "application/zip",
      }),
    );
    await clients.cloudformation.send(
      new UpdateStackCommand({
        StackName: STACK_NAME,
        TemplateBody: templateBody,
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        Parameters: [
          { ParameterKey: "EvidenceBucketName", ParameterValue: bucket },
          { ParameterKey: "LambdaCodeKey", ParameterValue: key },
          { ParameterKey: "PermissionsBoundaryArn", ParameterValue: input.permissionsBoundaryArn ?? "" },
        ],
        Tags: tags,
      }),
    );
    return await getStackState(clients);
  }

  // CREATING / UPDATING / DELETING / COMPLETE / FAILED: nothing to issue — the
  // caller polls and the state speaks for itself.
  return state;
}

/**
 * Run one advance at a time. A call arriving while another is in flight gets the live state and
 * issues nothing.
 *
 * The Evidence screen polls every 5s; an advance's first step uploads the ~3 MB snapshot bundle,
 * which takes longer than that. Without this, the next poll re-read "storage ready" — the first
 * advance had not reached its UpdateStack yet — uploaded the bundle again and issued a second
 * UpdateStack against a stack already updating. That one failed, and the failure was all the
 * screen ever saw.
 */
export function oneAtATime(
  advance: () => Promise<StackState>,
  read: () => Promise<StackState>,
): () => Promise<StackState> {
  let inFlight = false;
  return async () => {
    if (inFlight) return await read();
    inFlight = true;
    try {
      return await advance();
    } finally {
      inFlight = false;
    }
  };
}

export async function deleteStack(clients: Clients): Promise<void> {
  try {
    await clients.cloudformation.send(new DeleteStackCommand({ StackName: STACK_NAME }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}
