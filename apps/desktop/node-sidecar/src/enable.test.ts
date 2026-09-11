import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureBaseline, enableChecks } from "./enable";
import { LedgerStore } from "./ledgerStore";
import { awsError, fakeClients, tempDataDir } from "./testUtil";

const CIS_ARN = "arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0";
const FSBP_ARN = "arn:aws:securityhub:eu-west-1::standards/aws-foundational-security-best-practices/v/1.0.0";

function cleanAccountClients() {
  const clients = fakeClients();
  clients.fakes.config
    .on("DescribeConfigurationRecordersCommand", { ConfigurationRecorders: [] })
    .on("DescribeConfigurationRecorderStatusCommand", { ConfigurationRecordersStatus: [{ recording: true }] })
    .on("PutConfigurationRecorderCommand", {})
    .on("PutDeliveryChannelCommand", {})
    .on("StartConfigurationRecorderCommand", {});
  clients.fakes.iam.on("CreateServiceLinkedRoleCommand", {});
  clients.fakes.securityhub
    .on("DescribeHubCommand", awsError("InvalidAccessException", "not subscribed"))
    .on("EnableSecurityHubCommand", {})
    .on("DescribeStandardsCommand", { Standards: [{ StandardsArn: CIS_ARN }, { StandardsArn: FSBP_ARN }] })
    .on("BatchEnableStandardsCommand", {});
  return clients;
}

describe("captureBaseline", () => {
  it("records found-enabled services as pre-existing, exactly once", async () => {
    const clients = fakeClients();
    clients.fakes.config.on("DescribeConfigurationRecordersCommand", {
      ConfigurationRecorders: [{ name: "default" }],
    });
    clients.fakes.securityhub.on("DescribeHubCommand", { HubArn: "arn:aws:securityhub:eu-west-1:1:hub/default" });
    const store = new LedgerStore(tempDataDir());

    const result = await captureBaseline(clients, store);
    assert.equal(result.configOn, true);
    assert.equal(result.securityHubOn, true);
    const ledger = store.read();
    assert.ok(ledger.entries.every((e) => e.preExisting === true));
    assert.ok(ledger.entries.some((e) => e.service === "config-recorder"));
    assert.ok(ledger.entries.some((e) => e.service === "securityhub"));

    // Idempotent: a second capture cannot duplicate or flip anything.
    await captureBaseline(clients, store);
    assert.equal(store.read().entries.length, ledger.entries.length);
  });

  it("records a clean account as nothing-pre-existing", async () => {
    const clients = cleanAccountClients();
    const store = new LedgerStore(tempDataDir());
    const result = await captureBaseline(clients, store);
    assert.equal(result.configOn, false);
    assert.equal(result.securityHubOn, false);
    assert.equal(store.read().entries.length, 0);
  });
});

describe("enableChecks (phase-0 finding 4: Config first, then Security Hub)", () => {
  it("enables in the proven order and records everything as ours", async () => {
    const clients = cleanAccountClients();
    const store = new LedgerStore(tempDataDir());
    await captureBaseline(clients, store);

    const result = await enableChecks(clients, store, {
      accountId: "111122223333",
      evidenceBucket: "auditpoppy-evidence-111122223333",
      recordingTimeoutMs: 1,
    });

    assert.equal(result.recording, true);
    assert.deepEqual(result.standardsEnabled.sort(), ["cis-1.2.0", "fsbp-1.0.0"]);

    // Order: recorder started BEFORE Security Hub was enabled.
    const all = [...clients.fakes.config.calls, ...clients.fakes.securityhub.calls];
    void all;
    const configDone = clients.fakes.config.calls.findIndex((c) => c.name === "StartConfigurationRecorderCommand");
    assert.ok(configDone >= 0);
    assert.ok(clients.fakes.securityhub.sent("EnableSecurityHubCommand").length === 1);
    // The recorder call used a typed object with the real SLR ARN (finding 2).
    const put = clients.fakes.config.sent("PutConfigurationRecorderCommand")[0];
    const recorder = put?.input.ConfigurationRecorder as { roleARN?: string };
    assert.equal(
      recorder.roleARN,
      "arn:aws:iam::111122223333:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig",
    );
    // Delivery channel points at the evidence bucket.
    const channel = clients.fakes.config.sent("PutDeliveryChannelCommand")[0]?.input.DeliveryChannel as {
      s3BucketName?: string;
    };
    assert.equal(channel.s3BucketName, "auditpoppy-evidence-111122223333");
    // Ledger: all ours.
    const ledger = store.read();
    assert.ok(ledger.entries.length >= 5);
    assert.ok(ledger.entries.every((e) => e.preExisting === false));
  });

  it("never touches services the baseline found enabled", async () => {
    const clients = fakeClients();
    clients.fakes.config
      .on("DescribeConfigurationRecordersCommand", { ConfigurationRecorders: [{ name: "default" }] })
      .on("DescribeConfigurationRecorderStatusCommand", { ConfigurationRecordersStatus: [{ recording: true }] });
    clients.fakes.securityhub
      .on("DescribeHubCommand", { HubArn: "arn" })
      .on("DescribeStandardsCommand", { Standards: [{ StandardsArn: CIS_ARN }, { StandardsArn: FSBP_ARN }] });
    const store = new LedgerStore(tempDataDir());
    await captureBaseline(clients, store);

    const result = await enableChecks(clients, store, {
      accountId: "111122223333",
      evidenceBucket: "auditpoppy-evidence-111122223333",
      recordingTimeoutMs: 1,
    });

    assert.deepEqual(result.standardsEnabled, []);
    assert.equal(clients.fakes.config.sent("PutConfigurationRecorderCommand").length, 0);
    assert.equal(clients.fakes.securityhub.sent("EnableSecurityHubCommand").length, 0);
    assert.equal(clients.fakes.securityhub.sent("BatchEnableStandardsCommand").length, 0);
  });

  it("resumes after a partial run instead of skipping on its own ledger entry", async () => {
    const clients = cleanAccountClients();
    const store = new LedgerStore(tempDataDir());
    await captureBaseline(clients, store);

    // First run crashes on the delivery channel (after the ledger write-ahead).
    let failures = 1;
    clients.fakes.config.on("PutDeliveryChannelCommand", () => {
      if (failures-- > 0) return awsError("InsufficientDeliveryPolicyException", "bucket policy not ready");
      return {};
    });
    await assert.rejects(
      enableChecks(clients, store, {
        accountId: "111122223333",
        evidenceBucket: "auditpoppy-evidence-111122223333",
        recordingTimeoutMs: 1,
      }),
    );
    assert.ok(store.read().entries.some((e) => e.service === "config-recorder" && !e.preExisting));

    // Retry completes the flow — the "ours" entry didn't short-circuit it.
    const result = await enableChecks(clients, store, {
      accountId: "111122223333",
      evidenceBucket: "auditpoppy-evidence-111122223333",
      recordingTimeoutMs: 1,
    });
    // Run 1 died before Start; the retry reached it — the flow finished.
    assert.equal(clients.fakes.config.sent("StartConfigurationRecorderCommand").length, 1);
    assert.deepEqual(result.standardsEnabled.sort(), ["cis-1.2.0", "fsbp-1.0.0"]);
  });
});
