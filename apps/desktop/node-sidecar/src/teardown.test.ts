import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyLedger, recordService } from "@auditpoppy/core";
import { LedgerStore } from "./ledgerStore";
import { runTeardown } from "./teardown";
import { awsError, fakeClients, tempDataDir } from "./testUtil";

const CIS_SUB = "arn:aws:securityhub:eu-west-1:1:subscription/cis-aws-foundations-benchmark/v/1.2.0";

function baseClients() {
  const clients = fakeClients();
  clients.fakes.securityhub
    .on("GetEnabledStandardsCommand", {
      StandardsSubscriptions: [
        { StandardsArn: "arn:...cis-aws-foundations-benchmark/v/1.2.0", StandardsSubscriptionArn: CIS_SUB, StandardsStatus: "READY" },
      ],
    })
    .on("BatchDisableStandardsCommand", {})
    .on("DisableSecurityHubCommand", {});
  clients.fakes.config
    .on("StopConfigurationRecorderCommand", {})
    .on("DeleteDeliveryChannelCommand", {})
    .on("DeleteConfigurationRecorderCommand", {});
  clients.fakes.iam.on("DeleteServiceLinkedRoleCommand", {});
  clients.fakes.s3
    .on("ListObjectVersionsCommand", {
      Versions: [{ Key: "evidence/2026/x.json", VersionId: "v1" }],
      DeleteMarkers: [],
      IsTruncated: false,
    })
    .on("DeleteObjectsCommand", {});
  clients.fakes.cloudformation
    .on("DeleteStackCommand", {})
    .on("DescribeStacksCommand", awsError("ValidationError", "Stack does not exist"));
  return clients;
}

describe("runTeardown (DESIGN §3: disable exactly what we enabled)", () => {
  it("disables ours, empties the bucket, deletes the stack", async () => {
    const clients = baseClients();
    const store = new LedgerStore(tempDataDir());
    const now = new Date();
    let ledger = emptyLedger();
    for (const s of [
      "config-slr",
      "config-recorder",
      "config-delivery-channel",
      "securityhub",
      "securityhub-standard:cis-1.2.0",
    ] as const) {
      ledger = recordService(ledger, s, false, now);
    }
    store.write(ledger);

    const report = await runTeardown(clients, store, { accountId: "111122223333", stackTimeoutMs: 1 });
    assert.deepEqual(report.problems, []);
    assert.equal(report.bucketEmptied, true);
    assert.equal(report.stackDeleted, true);
    assert.ok(report.disabled.includes("securityhub"));
    assert.ok(report.disabled.includes("config-recorder"));
    assert.equal(clients.fakes.securityhub.sent("DisableSecurityHubCommand").length, 1);
    assert.equal(clients.fakes.config.sent("DeleteConfigurationRecorderCommand").length, 1);
    assert.equal(clients.fakes.iam.sent("DeleteServiceLinkedRoleCommand").length, 1);
    // The bucket empty deleted the exact listed version.
    const del = clients.fakes.s3.sent("DeleteObjectsCommand")[0]?.input.Delete as {
      Objects: { Key: string; VersionId: string }[];
    };
    assert.deepEqual(del.Objects, [{ Key: "evidence/2026/x.json", VersionId: "v1" }]);
  });

  it("NEVER touches pre-existing services — found enabled, not ours", async () => {
    const clients = baseClients();
    const store = new LedgerStore(tempDataDir());
    const now = new Date();
    let ledger = emptyLedger();
    ledger = recordService(ledger, "config-recorder", true, now);
    ledger = recordService(ledger, "securityhub", true, now);
    ledger = recordService(ledger, "securityhub-standard:cis-1.2.0", true, now);
    store.write(ledger);

    const report = await runTeardown(clients, store, { accountId: "111122223333", stackTimeoutMs: 1 });
    assert.equal(clients.fakes.securityhub.sent("DisableSecurityHubCommand").length, 0);
    assert.equal(clients.fakes.securityhub.sent("BatchDisableStandardsCommand").length, 0);
    assert.equal(clients.fakes.config.sent("StopConfigurationRecorderCommand").length, 0);
    assert.equal(clients.fakes.config.sent("DeleteConfigurationRecorderCommand").length, 0);
    assert.deepEqual(report.leftAlone.sort(), ["config-recorder", "securityhub", "securityhub-standard:cis-1.2.0"]);
    // The poppy's own stack + bucket still go.
    assert.equal(report.stackDeleted, true);
  });

  it("is idempotent: a second run tolerates everything already being gone", async () => {
    const clients = fakeClients();
    clients.fakes.securityhub
      .on("GetEnabledStandardsCommand", awsError("InvalidAccessException", "not subscribed"))
      .on("DisableSecurityHubCommand", awsError("InvalidAccessException", "not subscribed"));
    clients.fakes.config
      .on("StopConfigurationRecorderCommand", awsError("NoSuchConfigurationRecorderException"))
      .on("DeleteDeliveryChannelCommand", awsError("NoSuchDeliveryChannelException"))
      .on("DeleteConfigurationRecorderCommand", awsError("NoSuchConfigurationRecorderException"));
    clients.fakes.iam.on("DeleteServiceLinkedRoleCommand", awsError("NoSuchEntityException"));
    clients.fakes.s3.on("ListObjectVersionsCommand", awsError("NoSuchBucket"));
    clients.fakes.cloudformation
      .on("DeleteStackCommand", {})
      .on("DescribeStacksCommand", awsError("ValidationError", "Stack does not exist"));

    const store = new LedgerStore(tempDataDir());
    const now = new Date();
    let ledger = emptyLedger();
    for (const s of ["config-slr", "config-recorder", "config-delivery-channel", "securityhub"] as const) {
      ledger = recordService(ledger, s, false, now);
    }
    store.write(ledger);

    const report = await runTeardown(clients, store, { accountId: "111122223333", stackTimeoutMs: 1 });
    assert.deepEqual(report.problems, []);
    assert.equal(report.bucketEmptied, true);
    assert.equal(report.stackDeleted, true);
  });
});
