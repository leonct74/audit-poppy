import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

  it("EVERY grant carries a human reason — including the narrow writes", () => {
    // This used to exempt anything scoped to our own stack, on the theory that a narrow grant
    // explains itself. It does not: the approval screen shows the person "iam: CreateRole,
    // DeleteRole, PutRolePolicy…" either way, and for a product whose whole pitch is legible
    // permissions, having the WRITES be the unexplained ones was exactly backwards. Every grant
    // that appears in front of a human says what it is for, in their words.
    for (const grant of permissionSet().grants) {
      assert.ok(
        grant.reason && grant.reason.length > 20,
        `${grant.service} @ ${grant.resourceScope} needs a reason`,
      );
    }
  });

  it("never grants a way to remove the limit the platform puts on it", () => {
    // The host attaches a permissions boundary to the role our stack creates, and the platform's
    // own security spec has a step outstanding that makes that boundary mandatory. Holding
    // DeleteRolePermissionsBoundary would step around that fix in a single call — create the
    // role bounded, then strip the boundary off. Putting a boundary ON is fine; taking one off
    // is not, and no legitimate flow here needs to.
    for (const grant of permissionSet().grants) {
      assert.ok(
        !grant.actions.includes("DeleteRolePermissionsBoundary"),
        "removing a permissions boundary is never AuditPoppy's to do",
      );
    }
  });

  it("grants no action it does not call — an unused write is only a liability", () => {
    // lambda:InvokeFunction was granted and never used: the monthly schedule invokes the
    // function, and EventBridge's own permission to do so lives in the template. A grant nobody
    // exercises cannot fail loudly when it is removed, so it survives by inertia until someone
    // finds a use for it that the person who approved it never agreed to.
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    for (const grant of permissionSet().grants) {
      if (grant.service !== "lambda") continue;
      assert.ok(!grant.actions.includes("InvokeFunction"), "nothing here invokes a function");
    }
    assert.ok(!/InvokeCommand/.test(source), "if this fires, the grant above is needed again");
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
  /**
   * Every AWS-defined helper role this poppy causes to exist, and the service that owns it.
   * Adding a service to the enable flow means adding a line here — which is the point: two
   * separate live failures (2026-09-05) were both "we enabled a service and forgot that AWS
   * would need to create a role for it", once explicitly and once as a hidden side effect of
   * EnableSecurityHub. The list makes the omission fail a test instead of a founder's account.
   */
  const SERVICE_LINKED_ROLES = [
    { service: "AWS Config", slr: "config.amazonaws.com/AWSServiceRoleForConfig" },
    { service: "AWS Security Hub", slr: "securityhub.amazonaws.com/AWSServiceRoleForSecurityHub" },
  ];

  it("can delete a service-linked role by the ARN the DELETE call is authorized against", () => {
    // Live teardown, 2026-09-07: creation was permitted all week, deletion was refused on
    // `arn:aws:iam::<account>:role/AWSServiceRoleForConfig`. DeleteServiceLinkedRole takes a
    // role NAME and IAM authorizes against a pathless ARN, while CreateServiceLinkedRole uses
    // the full aws-service-role/<service>/ path. Granting only the path form leaves a role
    // behind at teardown — the one promise "leaves no trace" cannot afford to break.
    const iam = permissionSet().grants.filter((g) => g.service === "iam");
    for (const role of ["AWSServiceRoleForConfig", "AWSServiceRoleForSecurityHub"]) {
      const pathless = `arn:aws:iam::*:role/${role}`;
      const ok = iam.some((g) => g.actions.includes("DeleteServiceLinkedRole") && g.resourceScope === pathless);
      assert.ok(ok, `no DeleteServiceLinkedRole grant on the pathless ARN for ${role}`);
    }
  });

  it("may create — and later delete — every service-linked role it causes to exist", () => {
    const iam = permissionSet().grants.filter((g) => g.service === "iam");
    for (const { service, slr } of SERVICE_LINKED_ROLES) {
      const onRole = iam.filter((g) => g.resourceScope.includes(slr));
      assert.ok(onRole.length > 0, `no grant covers ${service}'s service-linked role`);
      const actions = new Set(onRole.flatMap((g) => g.actions));
      assert.ok(actions.has("CreateServiceLinkedRole"), `${service}: cannot create its helper role`);
      // Leaves-no-trace: what we cause to exist, we must be able to remove.
      assert.ok(actions.has("DeleteServiceLinkedRole"), `${service}: cannot remove its helper role at teardown`);
    }
  });

  /**
   * Roles this poppy HANDS to a service, which is a narrower set than the roles it causes to
   * exist — and the distinction is the bug. PutConfigurationRecorder takes the Config role as a
   * parameter, so iam:PassRole is checked on it; EnableSecurityHub takes no role at all, so
   * PassRole there would be an over-grant. Creating a role and passing one are different
   * permissions, and only the APIs that pass belong here.
   */
  const PASSED_ROLES = [
    { api: "config:PutConfigurationRecorder", slr: "config.amazonaws.com/AWSServiceRoleForConfig" },
  ];

  it("can pass every role it hands to a service", () => {
    // Found live 2026-09-05: "not authorized to perform: iam:PassRole ... because no session
    // policy allows the iam:PassRole action". The mock enforces no IAM, so days of green smoke
    // runs could never have caught it.
    const iam = permissionSet().grants.filter((g) => g.service === "iam");
    for (const { api, slr } of PASSED_ROLES) {
      const passes = iam.some((g) => g.actions.includes("PassRole") && g.resourceScope.includes(slr));
      assert.ok(passes, `${api} hands over ${slr}, so iam:PassRole must be granted on it`);
    }
  });

  it("never grants PassRole on every role in the account", () => {
    for (const g of permissionSet().grants) {
      if (g.service !== "iam" || !g.actions.includes("PassRole")) continue;
      assert.notEqual(g.resourceScope, "*", "PassRole on \"*\" would let this hand over ANY role in the account");
    }
  });
});

/**
 * "`capabilities` lists ONLY what your frontend actually calls" (AGENTS.md §10).
 *
 * Two were declared and never called — `connection:read` and `host:notify` — because a manifest
 * gets written from the shape of a manifest rather than from the calls that earn each line. An
 * unused capability is the same liability as an unused grant: it widens what a person approves,
 * and removing it breaks nothing, so nothing ever removes it. This reads the frontend source, so
 * the manifest cannot drift back.
 */
describe("declared capabilities are earned by real calls", () => {
  // The platform's METHOD_CAPABILITY map, for the methods this poppy could use.
  const METHODS: Record<string, string[]> = {
    "aws:credentials": ["ensureAccess"],
    "connection:read": ["getConnection", "getAudit", "getInventory"],
    "backend:invoke": ["invokeBackend"],
    "host:openExternal": ["openExternal"],
    "host:notify": ["notify"],
    "commerce:purchase": ["purchaseInfo", "buyProduct", "isPurchased", "manageSubscription"],
  };

  const frontendDir = join(here, "..", "..", "src");
  const bridgePath = join(frontendDir, "lib", "host.ts");

  /** Every frontend source EXCEPT the bridge itself, which DEFINES the methods rather than calling them. */
  function frontendSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...frontendSources(full));
      else if (/\.tsx?$/.test(entry.name) && full !== bridgePath) out.push(readFileSync(full, "utf8"));
    }
    return out;
  }

  const source = frontendSources(frontendDir).join("\n");

  /**
   * Matches a call to `m`, allowing what real call sites actually look like:
   *   host.openExternal(…)            plain
   *   host\n  .purchaseInfo(…)         chained across lines — match the call, not the receiver
   *   host.invokeBackend<Status>(…)   a generic argument sits between the name and the paren
   * That last one is why the first version of this test reported the poppy's most-used
   * capability as unused.
   */
  const calls = (m: string): RegExp => new RegExp(`\\.${m}\\s*(<[^>]*>)?\\s*\\(`);
  const declared = (JSON.parse(readFileSync(manifestPath, "utf8")) as { capabilities: string[] }).capabilities;

  it("declares nothing the frontend never calls", () => {
    for (const capability of declared) {
      const methods = METHODS[capability];
      assert.ok(methods, `unknown capability "${capability}" — add it to METHODS above`);
      // Calls chain across lines (`host\n  .purchaseInfo(`), so match the call, not the receiver.
      const called = methods.some((m) => calls(m).test(source));
      assert.ok(called, `"${capability}" is declared but nothing calls ${methods.join("/")}`);
    }
  });

  it("declares everything the frontend does call — the other direction fails at runtime", () => {
    for (const [capability, methods] of Object.entries(METHODS)) {
      const called = methods.some((m) => calls(m).test(source));
      if (called) assert.ok(declared.includes(capability), `${methods.join("/")} is called but "${capability}" is not declared`);
    }
  });
});
