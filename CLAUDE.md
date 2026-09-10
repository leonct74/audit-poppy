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

**It was FOUR actions, not three (2026-09-10).** PR #1 merged the first three; the very next
certify run stranded on `iam:DeleteRolePolicy`, because the policy carried **no `iam:` action at
all**. Deleting `AWS::IAM::Role` is a sequence — enumerate inline policies, delete each, detach
managed ones, delete the role, read it back — and **any poppy that deploys compute deploys a
role**, so this is close to every poppy in the directory.
**https://github.com/leonct74/agentspoppy/pull/2 fixes it and is open.**

**The lesson that outlives these four actions:** each one was found by burning a full
deploy-use-certify cycle in a real account, one at a time, because the policy is maintained
action-by-action against no model of what a stack can contain. `DELETE_TIME_ACTIONS` in
`maintenance.test.ts` is now that model, and every fix has been pinned into it — but it is still
hand-maintained. Deriving it from the resource types the manifest validator permits is the thing
that ends the class; it is raised in both PRs and not yet done.

**And a poppy cannot rescue itself from this.** AuditPoppy grants itself exactly these actions on
exactly this role, and its teardown hook ran first — the run still failed under the HOST's
principal, because `service.teardown()` issues its own `DeleteStack` after the hook returns. The
host's credentials drive the deletion no matter how completely the poppy cleaned up.

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
- ✅ **Phase 0 CLOSED 2026-09-10** (`phase0-derisk.md`) — torn down by hand in the console.
  **The week cost $0.00**, which confirms the free-trial story but proves nothing about a
  populated account; never cite it as "AuditPoppy is free to run". **A real account of ~1,600
  resources estimates at ≈$19.46/month, live-priced — and AWS Config is 81% of it** while our own
  stack is five cents (finding 7). The expensive part is the change recording SOC 2 requires, so
  there is no cheaper design hiding in there. A deliberate residue is named
  there: the Config recorder and delivery channel remain, stopped and free, because **the AWS
  Config console has no delete for them at all** (finding 6) — API only, and there is no CLI
  profile for that account. That is a product argument too: a customer cannot undo Config by hand,
  which is what makes our teardown promise worth something.
  Three process findings, all the same shape — *something that looks like proof, accepted without
  asking what would have to be true for it to be proof*:
  1. **THERE ARE TWO ACCOUNTS** — sandbox (phase 0, eu-west-1) and production (tested and torn
     down 09-07). Conflating them cost time twice in three days. **Ask which account before
     believing any check.**
  2. Its "scheduled teardown + dead-man" **never existed** — the file asserted two scheduled tasks
     in confident prose; listing the account's routines returns an empty set. An assistant relayed
     that to the founder as "do nothing, a reminder will fire".
  3. This file was marked CLOSED on a console check run in the wrong account, and reopened one
     message later.
  **A safety net written down is not a safety net. Record how to VERIFY a claim beside the claim.**
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
- ✅ **Listing-readiness audited against AGENTS.md §10 + the release runbook (2026-09-07)**, using
  the platform's own tooling rather than by reading: `validate-manifest` green, and it **packs** —
  3.0 MB / 6 files, same sha256 across two runs (deterministic STORE zip, as promised). Two
  capabilities were declared and never called (`connection:read`, `host:notify`) and are gone,
  pinned now by a test that reads the frontend source. `npm run pack` added, because the packer
  looks for the backend at `apps/desktop/backend/index.cjs` while the build writes it to
  `node-sidecar/dist/index.cjs` — the same missing-script trap as `certify`. DESIGN §12 has the
  full result. **One thing to remember at submission: `bugsUrl` points at this repo's issues and
  this repo is still PRIVATE**, so the link 404s until the visibility flip — which must therefore
  happen before submission, not after.
- ⚠️ **Policies screen first live run (2026-09-07) — two real bugs, both fixed, one still
  undiagnosed.** On an account with 11 users the MFA read failed and the policy rendered
  *"11 user accounts, of which **not yet observed** lack MFA"* — in a document written for an
  auditor. Cause 1: the user count and the per-user MFA scan shared one `try`, so one failing
  user discarded everything already counted, silently. Cause 2: "not yet observed" was a VALUE,
  fine on a chip and a disaster in prose. Both fixed (DESIGN §5a), a partial scan now reports a
  FLOOR rather than a total, and the reason is shown on the screen instead of a blank.
  **ANSWERED on 2026-09-08, and it was not throttling:** `iam:ListMFADevices` on AgentsPoppy's own
  operator user is denied by the platform's `CannotTamperWithAgentsPoppy` guardrail (`Deny iam:*`
  on the broker role, the operator user and the boundary policy). That Deny is correct and stays;
  it costs exactly one unreadable account on every install. A Deny is now counted as an
  EXCLUSION, not a fault — exact count, one explaining sentence, no permanent scary banner.
- 🚨 **And it exposed a worse bug: the provider's error was being rendered INTO the policy
  document** — an account id, a role ARN, a session id, a user name and a console link, in a file
  a customer emails to an auditor. This repo has a rule about identifying data in its own files,
  and a test enforcing it; the same care had never been applied to what the product PRODUCES.
  Fixed by classify-then-write (never pass a provider message through) plus `documentSafe()` as a
  backstop on every value entering prose. DESIGN §5b. **Whenever you add text to a document,
  ask what an error string might carry into it.**
- 🚨 **Costs screen could not tell a forecast from a bill (2026-09-10).** "Total while enabled"
  and "Charged as soon as you turn it on" rendered IDENTICALLY whether the audit was running or
  not — so the founder, who built it, could not tell from the screen whether their own account was
  billing. Once running, "charged as soon as you turn it on" is actively false. Every figure now
  carries a tense. Worse, the same read: `checksOn` collapsed "nothing is enabled" and "we could
  not read your account" into one falsy value, so a FAILED read rendered the reassuring
  *"$0 — nothing running"* banner. **An unknown must never default to the reassuring answer** —
  same shape as the certificate that proved tearing down nothing leaves nothing.
- 🚨 **Removal could not be found — twice, by the person who designed its placement (2026-09-10).**
  It sat at the bottom of Costs, "next to the off switch", which reads well and is wrong. Now its
  own **Remove** tab before Feedback, pointer left on Costs. `tabs.test.ts` pins it — and pins the
  thing the change nearly broke: **nothing enforced "Feedback is the LAST tab"**, a listing
  requirement, so inserting a tab beside it was one character from unlistable. **A destructive
  action nobody can find is not tucked away safely; the person hunting for it has already decided.**
- ✅ **POLICIES SCREEN LIVE-VERIFIED (2026-09-08)** — the last item on the "never exercised live"
  list. Observed facts pre-fill correctly, typed answers persist across a tab switch, and they
  render into the policy body. **Every screen has now run against a real account.**
- ✅ **Listing copy written and test-pinned** (`packages/core/src/listing.ts`, `LISTING.md`).
  Writing it caught a conflict nobody had noticed: DESIGN §11.1 decided the tagline *"SOC 2
  audit-readiness in your own AWS"* on 09-02, and the cloud-neutral rule landed on 09-03 — the
  decided tagline fails this repo's own `checkCopy`. Settled to "in your own cloud"; the founder's
  search rationale survives because proper nouns stay, so "AWS Config" and "AWS Security Hub" are
  still in the description. Reversible in one line if the founder prefers the original.
- Next, in dependency order — **the whole listing chain is gated on certification, which is gated
  on the platform** (`LISTING.md` has the order and the two one-way steps):
  1. ~~phase-0 teardown~~ — done 2026-09-10;
  2. **merge https://github.com/leonct74/agentspoppy/pull/2** (PR #1 merged; the next certify run
     found a fourth gap, `iam:*` for role deletion) → then deploy, USE, and
     `npm run certify -- --yes`. After a failed run the stack sits in `DELETE_FAILED`: clear it
     from the poppy's own **Remove** screen, which runs as OUR session and can delete what the
     host could not;
  3. ~~click-test the PACKED build~~ — **done 2026-09-10, by proof rather than by clicking**: the
     packed zip is byte-identical to what `install-dev-extension.mjs` lays out (same six files,
     matching hashes on manifest, backend bundle and frontend entry), so the build already
     exercised on a real account across every screen IS the packed build. That also settles
     `machine: "aws-only"` — the host refuses undeclared connections on the real spawn path and
     refused nothing. Only the DIRECTORY install path stays unproven, and it cannot run before a
     catalog entry exists, so it is the first real install after submission, not a task;
  4. run the history check, then flip this repo public (fixes `bugsUrl` too);
  5. `npm run pack` → GitHub Release → catalog entry → submit.
  Platform-side and independent of the above: the commerce product, and deploying the signup.
