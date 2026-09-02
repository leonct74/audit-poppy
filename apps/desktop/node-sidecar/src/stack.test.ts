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
