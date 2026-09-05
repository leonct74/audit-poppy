import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { checkCopy } from "@auditpoppy/core";
import { permissionSet, STACK_NAME } from "./permissionSet";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "..", "extension.json");

/** Actions AWS genuinely cannot resource-scope (documented per grant reason):
 *  Config's account-level recorder API and Security Hub's account enablement. */
const NO_RESOURCE_LEVEL = new Set([
  "config:PutConfigurationRecorder",
  "config:PutDeliveryChannel",
  "config:StartConfigurationRecorder",
  "config:StopConfigurationRecorder",
  "config:DeleteConfigurationRecorder",
  "config:DeleteDeliveryChannel",
  "securityhub:EnableSecurityHub",
]);

const MUTATING = /^(Create|Put|Update|Delete|Enable|Disable|Batch|Start|Stop|Attach|Detach|Tag|Untag|Set|Add|Remove|Execute|Invoke|Send)/;

describe("the manifest and the declared permission set", () => {
  it("extension.json is exactly what permissionSet() generates (no drift)", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { permissionSet: unknown };
    assert.deepEqual(manifest.permissionSet, JSON.parse(JSON.stringify(permissionSet())));
  });

  it("every unconfined grant carries a human reason", () => {
    for (const grant of permissionSet().grants) {
      const confined = grant.resourceScope.includes(STACK_NAME) || grant.resourceScope.includes("auditpoppy-");
      if (!confined) {
        assert.ok(
          grant.reason && grant.reason.length > 20,
          `${grant.service} @ ${grant.resourceScope} needs a reason`,
        );
      }
    }
  });

  it("reasons explain purpose in plain words, never scope mechanics", () => {
    for (const grant of permissionSet().grants) {
      if (!grant.reason) continue;
      // The founder's test: no API names, ARNs, or grant-speak in a reason.
      assert.ok(!/arn:|resource type|IAM action|scope/i.test(grant.reason), `${grant.service}: "${grant.reason}"`);
      assert.deepEqual(checkCopy(grant.reason), [], `${grant.service} reason violates a law`);
    }
  });

  it("NO mutating action rides on * unless AWS forces it (the cardinal rule)", () => {
    for (const grant of permissionSet().grants) {
      if (grant.resourceScope !== "*") continue;
      for (const action of grant.actions) {
        if (!MUTATING.test(action)) continue;
        assert.ok(
          NO_RESOURCE_LEVEL.has(`${grant.service}:${action}`),
          `${grant.service}:${action} mutates on * but is not a documented no-resource-level action`,
        );
      }
    }
  });

  it("has NO auto-remediation surface: no writes to the services it audits", () => {
    // The audited estate: these services may appear ONLY as reads.
    for (const grant of permissionSet().grants) {
      if (["ec2", "rds", "cloudtrail"].includes(grant.service)) {
        for (const action of grant.actions) {
          assert.ok(/^(Describe|Get|List)/.test(action), `${grant.service}:${action} must be read-only`);
        }
      }
    }
  });

  it("declares all three doors: aws-only egress, no infrastructure, enforced machine", () => {
    const net = permissionSet().network;
    assert.equal(net.egress, "aws-only");
    assert.equal(net.infrastructure, "none");
    assert.equal(net.machine, "aws-only");
  });

  it("keeps the naming and pricing laws in every manifest string", () => {
    const manifestText = readFileSync(manifestPath, "utf8");
    assert.deepEqual(checkCopy(manifestText), []);
  });

  it("manifest structure: confined node22 backend, teardown hook, compliance block, Feedback prerequisites", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      backend?: { runtime?: string; isolation?: string };
      teardown?: { endpoint?: string };
      compliance?: { subprocessors?: unknown[] };
      capabilities?: string[];
      bugsUrl?: string;
    };
    assert.equal(manifest.backend?.runtime, "node22");
    assert.equal(manifest.backend?.isolation, "strict");
    assert.equal(manifest.teardown?.endpoint, "/teardown");
    assert.deepEqual(manifest.compliance?.subprocessors, []);
    assert.ok(manifest.capabilities?.includes("host:openExternal"));
    assert.ok(manifest.capabilities?.includes("commerce:purchase"));
    assert.ok(manifest.bugsUrl?.startsWith("https://"));
  });

  /**
   * The bug this pins was found by the founder pressing the button on a live account
   * (2026-09-05): "not authorized to perform: iam:PassRole ... because no session policy allows
   * the iam:PassRole action". The smoke loop had passed for days, because mock AWS does not
   * enforce IAM — so nothing but a real call could have caught it.
   *
   * The general lesson, and why this test is shaped this way: for every API that HANDS a role
   * to a service, creating the role is not the same permission as passing it. Test the pairing,
   * not just the presence of each action.
   */
  it("can pass every role it creates to the service that needs it", () => {
    const ps = permissionSet();
    const iam = ps.grants.filter((g) => g.service === "iam");
    const slrPattern = /aws-service-role\/config\.amazonaws\.com\/AWSServiceRoleForConfig/;

    const createsSlr = iam.filter((g) => g.actions.includes("CreateServiceLinkedRole"));
    assert.ok(createsSlr.length > 0, "expected a grant that creates the Config service-linked role");

    for (const g of createsSlr) {
      assert.ok(
        slrPattern.test(g.resourceScope),
        "the Config SLR grant should name the SLR, not a wildcard",
      );
      // PutConfigurationRecorder hands this role to Config; without PassRole on the SAME
      // resource, enabling fails at the last step with the recorder never starting.
      const passes = iam.some((other) => other.actions.includes("PassRole") && slrPattern.test(other.resourceScope));
      assert.ok(passes, "iam:PassRole must be granted on the Config service-linked role");
    }
  });

  it("never grants PassRole on every role in the account", () => {
    for (const g of permissionSet().grants) {
      if (g.service !== "iam" || !g.actions.includes("PassRole")) continue;
      assert.notEqual(g.resourceScope, "*", "PassRole on \"*\" would let this hand over ANY role in the account");
    }
  });
});
