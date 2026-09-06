import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchControls } from "./readiness";
import type { Clients } from "./clients";

const CONTROL_ARN = "arn:aws:securityhub:eu-west-1:111122223333:control/aws-foundational-security-best-practices/v/1.0.0/IAM.4";

/** A Security Hub that returns one control and whatever findings the test supplies. */
function hub(findings: unknown[]): Clients {
  return {
    securityhub: {
      async send(command: unknown) {
        const name = (command as { constructor: { name: string } }).constructor.name;
        if (name === "DescribeStandardsControlsCommand") {
          return {
            Controls: [
              { ControlId: "IAM.4", Title: "IAM root user access key should not exist", ControlStatus: "ENABLED", SeverityRating: "CRITICAL", StandardsControlArn: CONTROL_ARN },
            ],
          };
        }
        return { Findings: findings };
      },
    },
  } as unknown as Clients;
}

const standards = [{ standard: "fsbp-1.0.0", subscriptionArn: "sub", status: "READY" }] as never;

describe("reading control results back from Security Hub", () => {
  it("attributes a CONSOLIDATED finding, which carries no StandardsControlArn at all", async () => {
    // The live failure on 2026-09-06: 388 controls, every one "awaiting data", a full day after
    // enabling. Consolidated control findings identify the control by Compliance.SecurityControlId,
    // and the old lookup only ever read ProductFields.StandardsControlArn — so it matched nothing.
    const res = await fetchControls(hub([
      { Compliance: { Status: "FAILED", SecurityControlId: "IAM.4" }, GeneratorId: "security-control/IAM.4", Resources: [{ Id: "root" }] },
    ]), standards);
    assert.equal(res.findingsSeen, 1);
    assert.equal(res.findingsMatched, 1, "a consolidated finding must be attributed");
    assert.equal(res.controls[0].compliance, "FAILED");
  });

  it("still attributes the legacy shape, keyed by the control ARN", async () => {
    const res = await fetchControls(hub([
      { Compliance: { Status: "PASSED" }, ProductFields: { StandardsControlArn: CONTROL_ARN } },
    ]), standards);
    assert.equal(res.findingsMatched, 1);
    assert.equal(res.controls[0].compliance, "PASSED");
  });

  it("records a PASS — the filter used to throw every one of them away", async () => {
    // Security Hub marks a finding RESOLVED once the control passes. The old query demanded
    // WorkflowStatus NEW or NOTIFIED, so a passing control could never appear: the report was
    // structurally incapable of showing good news.
    const res = await fetchControls(hub([
      { Compliance: { Status: "PASSED", SecurityControlId: "IAM.4" }, Workflow: { Status: "RESOLVED" } },
    ]), standards);
    assert.equal(res.controls[0].compliance, "PASSED");
  });

  it("lets one FAILED outrank a PASSED for the same control", async () => {
    const res = await fetchControls(hub([
      { Compliance: { Status: "PASSED", SecurityControlId: "IAM.4" } },
      { Compliance: { Status: "FAILED", SecurityControlId: "IAM.4" }, Resources: [{ Id: "r1" }] },
    ]), standards);
    assert.equal(res.controls[0].compliance, "FAILED");
    assert.deepEqual(res.controls[0].failedResources, ["r1"]);
  });

  it("reports findings seen but unmatched, so a broken read path cannot pose as a warm-up", async () => {
    const res = await fetchControls(hub([
      { Compliance: { Status: "FAILED", SecurityControlId: "SomethingElse.9" } },
    ]), standards);
    assert.equal(res.findingsSeen, 1);
    assert.equal(res.findingsMatched, 0);
    assert.equal(res.controls[0].compliance, "NO_DATA");
  });

  it("says nothing was seen when nothing was returned — the genuine warm-up case", async () => {
    const res = await fetchControls(hub([]), standards);
    assert.equal(res.findingsSeen, 0);
    assert.equal(res.findingsMatched, 0);
  });
});
