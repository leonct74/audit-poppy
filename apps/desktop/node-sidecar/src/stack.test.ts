import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceDeploy, getStackState } from "./stack";
import { awsError, fakeClients } from "./testUtil";

const deployInput = {
  accountId: "111122223333",
  connectionId: "conn-1",
  lambdaCodeKey: "snapshot-abc.zip",
  lambdaZip: Buffer.from("zip"),
};

function describeStacks(status: string, codeKey: string) {
  return {
    Stacks: [
      {
        StackStatus: status,
        Parameters: [{ ParameterKey: "LambdaCodeKey", ParameterValue: codeKey }],
        Outputs: [{ OutputKey: "EvidenceBucket", OutputValue: "auditpoppy-evidence-111122223333" }],
      },
    ],
  };
}

describe("stack state is derived from AWS, never from memory (AGENTS.md §5)", () => {
  it("maps the lifecycle", async () => {
    const clients = fakeClients();
    clients.fakes.cloudformation.on("DescribeStacksCommand", awsError("ValidationError", "does not exist"));
    assert.equal((await getStackState(clients)).status, "ABSENT");

    clients.fakes.cloudformation.on("DescribeStacksCommand", describeStacks("CREATE_IN_PROGRESS", ""));
    assert.equal((await getStackState(clients)).status, "CREATING");

    clients.fakes.cloudformation.on("DescribeStacksCommand", describeStacks("CREATE_COMPLETE", ""));
    assert.equal((await getStackState(clients)).status, "STORAGE_READY");

    clients.fakes.cloudformation.on("DescribeStacksCommand", describeStacks("UPDATE_COMPLETE", "code/snapshot-abc.zip"));
    assert.equal((await getStackState(clients)).status, "COMPLETE");
  });

  it("phase A: from ABSENT it creates storage only (empty code key), tagged", async () => {
    const clients = fakeClients();
    let created = false;
    clients.fakes.cloudformation
      .on("DescribeStacksCommand", () =>
        created ? describeStacks("CREATE_IN_PROGRESS", "") : awsError("ValidationError", "does not exist"),
      )
      .on("CreateStackCommand", () => {
        created = true;
        return {};
      });

    const state = await advanceDeploy(clients, deployInput);
    assert.equal(state.status, "CREATING");
    const call = clients.fakes.cloudformation.sent("CreateStackCommand")[0]?.input as {
      Parameters: { ParameterKey: string; ParameterValue: string }[];
      Tags: { Key: string; Value: string }[];
    };
    assert.equal(call.Parameters.find((p) => p.ParameterKey === "LambdaCodeKey")?.ParameterValue, "");
    assert.ok(call.Tags.some((t) => t.Key === "agentspoppy:app" && t.Value === "com.auditpoppy.desktop"));
    assert.ok(call.Tags.some((t) => t.Key === "agentspoppy:connection" && t.Value === "conn-1"));
  });

  it("phase B: from STORAGE_READY it uploads the code then updates the stack", async () => {
    const clients = fakeClients();
    let updated = false;
    clients.fakes.cloudformation
      .on("DescribeStacksCommand", () =>
        updated ? describeStacks("UPDATE_IN_PROGRESS", "code/snapshot-abc.zip") : describeStacks("CREATE_COMPLETE", ""),
      )
      .on("UpdateStackCommand", () => {
        updated = true;
        return {};
      });
    clients.fakes.s3.on("PutObjectCommand", {});

    const state = await advanceDeploy(clients, deployInput);
    assert.equal(state.status, "UPDATING");
    const put = clients.fakes.s3.sent("PutObjectCommand")[0]?.input as { Bucket: string; Key: string };
    assert.equal(put.Bucket, "auditpoppy-evidence-111122223333");
    assert.equal(put.Key, "code/snapshot-abc.zip");
    const update = clients.fakes.cloudformation.sent("UpdateStackCommand")[0]?.input as {
      Parameters: { ParameterKey: string; ParameterValue: string }[];
    };
    assert.equal(
      update.Parameters.find((p) => p.ParameterKey === "LambdaCodeKey")?.ParameterValue,
      "code/snapshot-abc.zip",
    );
  });

  it("mid-flight states advance nothing — the poll just reports", async () => {
    const clients = fakeClients();
    clients.fakes.cloudformation.on("DescribeStacksCommand", describeStacks("CREATE_IN_PROGRESS", ""));
    const state = await advanceDeploy(clients, deployInput);
    assert.equal(state.status, "CREATING");
    assert.equal(clients.fakes.cloudformation.sent("CreateStackCommand").length, 0);
    assert.equal(clients.fakes.s3.sent("PutObjectCommand").length, 0);
  });
});

describe("a stack left in a failed state by something OTHER than a create", () => {
  it("clears a rolled-back create, then STOPS — one press is one attempt", async () => {
    // The first version deleted and returned live state, so the very next poll created again:
    // create → roll back → delete → create, every few seconds, under a "Creating…" label. An
    // unbounded retry that hides its own cause is worse than the failure it retries past.
    const clients = fakeClients();
    clients.fakes.cloudformation
      .on("DescribeStacksCommand", {
        Stacks: [{ StackStatus: "ROLLBACK_COMPLETE", StackStatusReason: "bucket already exists" }],
      })
      .on("DeleteStackCommand", {})
      .on("CreateStackCommand", {});
    const state = await advanceDeploy(clients, deployInput);

    assert.equal(clients.fakes.cloudformation.sent("DeleteStackCommand").length, 1,
      "a ROLLBACK_COMPLETE stack holds its own name until it is deleted");
    assert.equal(clients.fakes.cloudformation.sent("CreateStackCommand").length, 0,
      "and must NOT create again in the same step — that is the loop");
    assert.equal(state.status, "FAILED");
    // The reason is carried OUT before the delete destroys it — it is the only thing that says why.
    assert.match(state.statusReason ?? "", /bucket already exists/);
    assert.match(state.statusReason ?? "", /try again/);
  });

  it("NEVER deletes a stack whose removal half-finished — that would destroy the evidence bucket", async () => {
    // Nothing in this template is DeletionPolicy: Retain, on purpose, so teardown can leave no
    // trace. Finishing a delete is therefore destructive, and the button that reaches here says
    // "Set up evidence collection". It belongs behind the removal screen's export gate and
    // type-to-confirm, not here. The founder hit this state on 2026-09-07 after a certify run
    // failed part-way, and the screen offered a retry that could not do anything.
    const clients = fakeClients();
    clients.fakes.cloudformation
      .on("DescribeStacksCommand", describeStacks("DELETE_FAILED", "code/snapshot-abc.zip"))
      .on("DeleteStackCommand", {})
      .on("CreateStackCommand", {});
    const state = await advanceDeploy(clients, deployInput);
    assert.equal(state.status, "FAILED");
    assert.equal(state.rawStatus, "DELETE_FAILED");
    assert.equal(clients.fakes.cloudformation.sent("DeleteStackCommand").length, 0,
      "setup must never finish someone's removal for them");
    assert.equal(clients.fakes.cloudformation.sent("CreateStackCommand").length, 0,
      "and it cannot create over it either — AWS holds the name");
  });
});
