# CLAUDE.md — AuditPoppy

Operating guide for working in this repo. **`DESIGN.md` is the source of truth** — read it
fully before any work; when a design decision changes, update DESIGN.md in the same change.

> **Boundary:** AuditPoppy is a standalone project that runs *on* AgentsPoppy (never
> forks it). The mailpoppy / traffic-poppy / other poppy repos are READ-ONLY reference
> material: copy patterns from them, never modify them from here.

## What this is

SOC 2 **audit-readiness** for the customer's own AWS account, from inside their own AWS
account — gap report, continuous evidence collection, policy pack, auditor export. The
anti-Vanta wedge: *compliance evidence that never leaves your cloud.*

## Installing into the local AgentsPoppy (the usual test loop)

From this repo on the founder's machine: `npm install && npm run install:local` — builds
everything and lays the extension into `~/.agentspoppy/extensions/` (uses the platform's
dev installer when the agentspoppy repo is at `~/Projects/agentspoppy` or
`$AGENTSPOPPY_REPO`; otherwise lays out the documented structure itself). Then RELAUNCH
AgentsPoppy and approve the connection from the AuditPoppy tab.

## ⚠️ This repository is going PUBLIC — and its history goes with it

AuditPoppy ships as open source (founder, 2026-09-03), so nothing sensitive may be visible
here. Two rules, and the second is the one that gets forgotten:

1. **Nothing identifying goes in, ever.** No account ids, IAM user or role names, CLI profile
   names, bucket names derived from an account, internal hostnames, or costs tied to a named
   account. Not because they are secrets — because an account id seeds cross-account role
   probing, bucket-name guessing and support-desk social engineering, and it buys a reader
   nothing. Placeholders and AWS's documented example ids (`111122223333`) are fine. Findings,
   lessons and mechanisms are the point and belong here.

2. **The history is published too.** AuditPoppy goes public the way every poppy does: this
   repo's visibility is flipped, no mirror (the AgentsPoppy broker is the only repo that
   publishes through one, because its monorepo carries internal working state). So git history
   goes public with the tip, and a redaction at the tip is not a deletion.

   **This was done once, on 2026-09-04.** History carried a real sandbox account id, an IAM user
   name and a CLI profile name in `CLAUDE.md`, `DESIGN.md` and `phase0-derisk.md`; every commit
   on `main` and on the working branch was rewritten to replace them, and both branches were
   force-pushed. Nothing in this repository's history contains them now. If you find yourself
   about to add one, don't — the guard below will stop you anyway.

Before flipping the switch, re-run the check over history rather than only the tip:

```bash
git grep -hoE "[0-9]{12}" $(git rev-list --all) -- '*.md' '*.ts' '*.tsx' '*.mjs' '*.json' \
  | sort -u | grep -vE "111122223333|123456789012|444455556666|555555555555"
```

The tip is guarded automatically by `packages/core/src/naming.test.ts`, which walks the whole
repository — docs and tests included — and fails on any 12-digit id that is not one of AWS's
documented example ids. Its lookarounds are digits-only on purpose: an earlier version excluded
letters too and walked straight past an id that a shell had glued to the following word, which
is exactly how one survived the first redaction. History has no such guard; the check above is
the one thing a human must run.

Anything security-sensitive about the PLATFORM (how the licence endpoints can be abused, what
was fixed, what risk was accepted) belongs in the private `agentspoppy-web` repo next to the
code it describes — see `docs/security-review-license-flow.md` there — never in this one.

## Certification (`npm run certify -- --yes`)

The leaves-no-trace harness lives in the **agentspoppy** repo, not here; `scripts/certify.mjs`
finds it (`AGENTSPOPPY_REPO`, then `~/Projects/agentspoppy`, then `../agentspoppy`) and passes
`--extension` for you — so never pass another, or it resolves against the platform directory
instead. It refuses to run without `--yes`, because it performs a **real** teardown.

**The order is the opposite of the intuitive one, and getting it wrong costs a full cycle:**
certify tears down ITSELF, then sweeps for anything left tagged. So it needs the poppy currently
deployed and used. Tear down first and there is nothing to certify. **Certify first, then rebuild
for real.** The certificate is only written when the run passes, so a failed run leaves you with
nothing and you must deploy and use the poppy again before retrying.

A ⚠️ warning about a resource the tag index still lists is **not** a failure — AWS's index lags
its own reality (Cognito pools for days). Open the linked resource: gone means gone. Never
"fix" that warning by weakening teardown.

**But one ⚠️ IS worthless-certificate-shaped**, and it looks like a pass (2026-09-07): *"Nothing
tagged with your app id was found before teardown."* With `footprint before: 0 resources` and
`stacks deleted: none`, the run proved only that tearing down nothing leaves nothing. A real run
needs the poppy deployed AND USED first — start the audit, deploy the evidence stack, and capture
a snapshot so the bucket has **objects in it**, because emptying a versioned bucket with contents
is the part of teardown most likely to break. The certificate it writes
(`leaves-no-trace.cert.json`) is gitignored: it records the AWS account the run happened in, and
this repo goes public.

**Certification is BLOCKED on a platform fix (2026-09-07), not on anything in this repo.** The
host's maintenance session — which is what certify deletes stacks with — cannot delete three of
this stack's resource types. CloudFormation deletes a stack with the CALLER's credentials, so
its session policy (`agentspoppy`, `packages/broker/src/aws/maintenance.ts`,
`MAINTENANCE_POLICY_STATEMENTS`) has to cover every resource type a poppy's template creates.
**It is THREE actions, not one** — the first reading of this said `lambda:RemovePermission` alone,
from a grep that only looked at `lambda:` lines, and that cost a second failed cycle:

| Resource that sticks | Action CloudFormation calls | In the maintenance policy |
| --- | --- | --- |
| `AWS::Lambda::Permission` | `lambda:RemovePermission` | ✗ |
| `AWS::S3::BucketPolicy` | `s3:DeleteBucketPolicy` | ✗ — it has `DeleteBucket`, a different action |
| `AWS::DynamoDB::Table` | `dynamodb:DescribeTable` (polled to confirm) | ✗ — it has `DeleteTable`, not the poll |

The stack ends in `DELETE_FAILED` and no certificate is written. This is not AuditPoppy-shaped:
any poppy with a scheduled Lambda, a bucket policy or a table hits it. DESIGN §3 records why no
workaround exists on this side. **Our own session has all three**, so AuditPoppy's own Remove
screen clears a stack that certify could not — which is the diagnostic: if the app can delete it
and the host cannot, the gap is the host's.

**When an AccessDenied appears, read the PRINCIPAL first:** `agentspoppy-<uuid>` is this poppy's
session and the fix is our manifest; `AgentsPoppyHost-maintenance` is the host's own and the fix
is the platform's. And read the whole policy, not the lines matching the service you suspect.

## The three laws that bind every word and grant

1. **Naming law (DESIGN §0):** never "SOC 2 compliant/certified" — only a licensed CPA firm
   attests. Copy says "audit-ready", "evidence for your SOC 2 audit". Test-pin it like the
   platform dossier does.
2. **Cloud-neutral rule (DESIGN §0a):** user-facing copy says "cloud", never "AWS" — more
   clouds follow. Proper nouns stay ("AWS Config", "AWS Security Hub", the CIS benchmark's
   title) — renaming those makes the product unusable, not neutral. Test-pinned too.
3. **Wide READ, narrow WRITE (DESIGN §4):** reads may be wide but must be enumerated and
   reasoned; writes only to its own stack/bucket/table + service enablement. **No
   auto-remediation, ever** — a wide-write compliance tool destroys its own trust story.

## Status

- ✅ DESIGN.md drafted (2026-09-02). **Name DECIDED: AuditPoppy** (id
  `com.auditpoppy.desktop`; tagline carries "SOC 2", the name never does — §11.1).
  **Licensing DECIDED: three tiers — personal free (watermarked exports); under-10-employee
  companies free with mandatory AgentsPoppy registration (identity known, granted license,
  clean exports); 10+ paid. No DRM** (§8). **Price DECIDED: $499/yr — as the /admin-editable commerce-db value; NEVER hardcode a
  dollar amount in poppy code, manifest, listing copy or screenshots.** **Policy pack in v1: INCLUDED. Host-enforced
  `machine: "aws-only"`: YES — first enforced-chip poppy.** All §11 questions decided;
  the design is complete.
- ✅ Phase 0 de-risk LIVE since 2026-09-02 (`phase0-derisk.md`): Audit Manager cut
  (closed to new accounts); enable order + read path verified; costs measuring for a
  week; teardown + dead-man scheduled (09-09 / 09-20).
- ✅ **Full build DONE (2026-09-02, phases 1–3 + the in-app half of 4 — DESIGN §12).**
- ✅ **LIVE-VERIFIED END TO END against a real production account (2026-09-05 → 07):**
  install → connect → start the audit → evidence stack → snapshot → export. Six real bugs
  that no mocked test could have found, because the mock enforces no IAM and returns findings
  in a shape AWS no longer uses:
  1. `iam:PassRole` missing on the Config service-linked role — enabling died at the last step.
  2. `iam:CreateServiceLinkedRole` missing on Security Hub's own role, which
     `EnableSecurityHub` creates as a side effect. Teardown would also have orphaned it.
  3. No retry configuration at all: a live account throttles where a mock never will.
  4. Credentials invalidated early (re-approval rotates the session) wedged the sidecar
     permanently — the SDK memoizes the identity, so the CLIENT has to be rebuilt.
  5. Consolidated control findings were unmatchable, and passing findings were filtered out
     at source: the gap report was structurally empty and said "awaiting data" about it.
  6. The CIS half of the mapping could never receive a finding (`equivalence.ts`).
  **The lesson worth keeping: every one of these lived in the gap between the mock and AWS.
  Mocked tests prove the logic; only a real account proves the contract.**
- ✅ Mapping expanded to 2026.09.1 (121 entries) after the live report showed more FAILING
  controls outside the criteria than inside. On that account: 0 failures now unmapped.
- ✅ **Security-reviewed (2026-09-07)** — the whole poppy, not just the diff, because it is about
  to be published. Three findings confirmed and fixed here (loopback port had no caller check;
  no S3 call asserted the bucket owner; the paid licence keyed on the buyer instead of the
  audited account), one rejected, plus a `/status` read-consistency race the smoke loop caught.
  DESIGN §4 and §6 carry the detail. **Two platform items came out of it and are NOT ours to
  patch:** the sidecar cannot authenticate a local peer alone (the broker forwards with no auth
  header — `registry.ts`, which is *not* a §4 enforcement-point file), and the permission-set
  escalation is the platform's own tracked "2026-08-26 fault A, step 3" (the mandatory
  permissions boundary). We removed `iam:DeleteRolePermissionsBoundary` so we cannot step around
  that fix when it lands.
- ✅ **TEARDOWN LIVE-VERIFIED against the real account (2026-09-07)** — clean, no problems
  reported: both standards and Security Hub off, Config delivery channel and recorder gone,
  **both service-linked roles deleted**, stack deleted, evidence bucket emptied and deleted.
  Three things this settles:
  1. The pathless-ARN fix for `DeleteServiceLinkedRole` works. The earlier teardown failed on
     exactly those two roles because the delete call names a role WITHOUT its path, so the
     path-qualified grant never matched. Both now come away.
  2. The stack it deleted was the one sitting in `DELETE_FAILED` after a failed certify run —
     including the `AWS::Lambda::Permission`, `AWS::S3::BucketPolicy` and `AWS::DynamoDB::Table`
     that the host's maintenance session could not remove. **Our session deletes what the host's
     cannot**, which turns the three-missing-actions diagnosis from a reading of the policy into
     a controlled comparison: same stack, same account, different principal, different outcome.
     `dynamodb:DescribeTable` is isolated cleanly — both principals hold `DeleteTable`.
  3. "Leaves no trace" is real behaviour now, not just a design claim. What remains is the
     FORMAL certificate, and that is blocked on the platform, not on this repo.
- Next: phase-0 teardown + cost readout (09-09) → `npm run certify` and the machine-gate
  check → platform-side items (commerce product, deploy the signup, catalogue submission)
  — DESIGN §12 "What remains before listing". Still unexercised live: **the Policies screen end
  to end** — and it is the one thing that needs nothing deployed, since `/policies` reads IAM,
  MFA coverage, the password policy and CloudTrail directly. It can be exercised on a torn-down
  account at zero cost, which is exactly what to do while certification waits on the platform.
