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

### ✅ Certify now REFUSES to start on a mismatch (preflight, 2026-09-11)

Two things silently void a run, and neither shows up in the harness's output — a voided run looks
exactly like a good one. Both have now cost a full deploy-use-wait cycle in a real account, so
`scripts/certify.mjs` checks them **before** the teardown and exits rather than warning:

1. **A stale agentspoppy checkout.** The harness runs from that repo, so an out-of-date checkout
   certifies with out-of-date code. On 09-11 the checkout was one commit short of `4bd2d0f`: the
   tag sweep was still signing with the stripped operator key, was denied in every region, read
   `footprint before: 0` with a whole stack standing — **and certified anyway**. The fix had been
   on `main` for a day; the instruction to pull it existed only in a chat message.
2. **An installed build that is not this one.** What gets certified is what the app is RUNNING.
   Skip `npm run install:local`, or skip the relaunch, and the certificate describes a different
   build than the code here. Checked by hashing the built backend bundle against the installed one.

An unreachable git remote **refuses** rather than assuming the best — an unknown must never default
to the reassuring answer. `--skip-platform-check` is the deliberate way past, deliberate because it
has to be typed.

**Why this had to be code and not a line in this file:** nobody working on this repo from a chat
session can see the founder's disk. The only thing that can verify the checkout at the moment it
matters is something running on that machine. Same lesson as phase 0's imaginary scheduled
teardown — *a safety net written down is not a safety net.*

**✅ Certification was BLOCKED on the platform and is not any more — ten actions across
`agentspoppy` PRs #1 and #2, both merged 2026-09-10.** Verified on `main` by reading
`packages/broker/src/aws/maintenance.ts` there, not by trusting a merge notification.

**Why the host needed anything at all:** CloudFormation deletes a stack with the CALLER's
credentials, and certify deletes stacks with the HOST's maintenance session — so that session's
policy (`MAINTENANCE_POLICY_STATEMENTS`) has to cover every resource type any poppy's template
can contain. When it does not, the stack ends in `DELETE_FAILED` and no certificate is written.
**A poppy cannot rescue itself from this**: AuditPoppy grants itself exactly the same actions on
exactly its own role and its teardown hook runs FIRST, and the run still failed under the host's
principal, because `service.teardown()` issues its own `DeleteStack` after the hook returns.

What was missing, in the order it was found — each one costing a full deploy-use-certify cycle in
a real account:

| Resource | What CloudFormation calls | Found |
| --- | --- | --- |
| `AWS::Lambda::Permission` | `lambda:RemovePermission` | 09-07 |
| `AWS::S3::BucketPolicy` | `s3:DeleteBucketPolicy` — not `DeleteBucket`, a different action | 09-10, PR #1 |
| `AWS::DynamoDB::Table` | `dynamodb:DescribeTable`, polled after the async delete | 09-10, PR #1 |
| `AWS::IAM::Role` | seven: enumerate inline policies, delete each, detach managed, delete, read back | 09-10, PR #2 |

Review reshaped PR #2 twice, both times correctly, and the reasoning is worth keeping:

- The three MUTATING IAM actions are **tag-scoped** (`HostRoleTeardown`, tag present, role ARNs).
  Both reasons the rest of that policy is unconditioned fail for IAM: roles support
  `aws:ResourceTag`, and an orphaned role costs nothing.
- The four READS are deliberately **unconditioned** (`HostRoleTeardownReads`, role ARNs), and this
  is the subtle one. `Null: "false"` needs the tag key in the request context, which needs a
  resource to read it from — and CloudFormation reads the role back **after** `DeleteRole`, when
  there is no role and no tag context. A tagged read would return **AccessDenied where
  NoSuchEntity was the success signal**, stranding the stack on the last step of its own
  successful deletion.
- `iam:DetachRolePolicy` needs a **second, unconditioned statement on the POLICY ARNs**: the call
  has two required resource types, and an execution role's managed policy is usually AWS-managed
  and can never carry our tag.

**The lesson that outlives the ten actions — the shape to look for next time: FOUR OF THE FIVE
gaps were actions that do not look like deletions** (`RemovePermission`, `DescribeTable`, and the
role read-backs). Anything generating this list by matching `Delete*` names would have missed
nearly all of them; it has to model the CALL SEQUENCE per resource type. `DELETE_TIME_ACTIONS` in
`maintenance.test.ts` is that model now and every fix is pinned into it, but it is still
hand-maintained. Deriving it from the resource types the manifest validator permits is what ends
the class; raised in both PRs, not yet done.

**When an AccessDenied appears, read the PRINCIPAL first:** `agentspoppy-<uuid>` is this poppy's
session and the fix is our manifest; `AgentsPoppyHost-maintenance` is the host's own and the fix
is the platform's. And read the whole policy, not the lines matching the service you suspect —
the first reading of the 09-07 failure said `lambda:RemovePermission` alone, off a grep that only
looked at `lambda:` lines, and that cost a cycle on its own.

**🚨 A rolled-back create is cleared ONCE and then stops (fixed 2026-09-10).** The first version of
that recovery deleted the stack and returned live state, so the next poll created again: create →
roll back → delete → create, every five seconds, under a "Creating…" label, and CloudFormation's
rollback reason died with each stack. **An unbounded retry that hides its own cause is worse than
the failure it retries past.** Now the reason is carried out before the delete, the state comes
back FAILED carrying it, and the retry is a button press — one press, one attempt.

**Redeploying immediately after certify is the case most likely to roll back.** Certify has just
deleted the evidence bucket and the snapshot role; S3 bucket names and IAM role names are both
eventually consistent after deletion, so recreating within minutes can fail on a name that AWS
still considers taken. That is not a bug in the poppy — wait a few minutes and press again.

**If a run strands again:** the CloudFormation **Events** tab names the resource and the denied
action. Clear the `DELETE_FAILED` stack from the poppy's own **Remove** tab — it runs as OUR
session, which can delete what the host could not, and that contrast is itself the diagnostic.

### ✅ FIXED: setup spun forever with the stack already finished (2026-09-10/11)

**The symptom, twice.** CloudFormation reported `AuditPoppyStack UPDATE_COMPLETE`; the Evidence
screen went on showing "Working…" and only a full poppy restart cleared it. The founder refused to
accept the restart as a fix — *"I want this to work without the user realising he has to restart"* —
which is the correct standard, and finding it took treating the second occurrence as a
reproduction rather than a coincidence.

**The cause: the display's only source of truth was a call that also mutated.** Every 5s tick
called `POST /deploy`, which both issued the next step AND returned the state. Two consequences
compounded:

1. An advance's first step uploads the ~3 MB snapshot bundle, which takes **longer than the 5s
   interval**. The next tick re-read "storage ready" — the first advance had not reached its
   `UpdateStack` yet — uploaded the bundle again and issued a **second `UpdateStack` against a
   stack already updating**. That one fails.
2. A tick that throws leaves `stack` untouched. So the screen kept the last state it happened to
   have while AWS went on and finished without it. Nothing was broken in the account; the screen
   simply stopped listening.

**The fix, in two halves:**

- `GET /stack` is a **pure read**, and it is what the screen displays. The read happens first on
  every tick, so the screen converges on what AWS says whatever the advance does.
- `oneAtATime()` (`stack.ts`) serialises the advance: a call arriving while another is in flight
  gets live state and issues nothing. Pinned by a test that holds an advance open, fires a second
  call, and asserts exactly one advance ran. The client keeps its own guard too — the one that
  matters is on the side that does the work.

**The general shape, which has now produced three bugs in this poppy:** *a poll that mutates.*
The rollback loop, the duplicate upload, and this. Any polling loop that issues writes needs an
overlap guard and a separate read, or it will eventually show a screen that has stopped tracking
reality.

**And the tell to remember:** the screen said "Working…" while the account was finished. Whenever
a UI insists something is in progress that another system says is done, suspect the UI's *source*
before its rendering — it is usually not listening any more, rather than listening and drawing
wrongly.

### ✅ The blind sweep is FIXED on the platform — both halves, merged 2026-09-10

**What it was.** The second certify run came back UNVERIFIED, and it was not index lag — the
sweep was *denied*. Two providers in the same run, two different credential planes:

| Provider | Credentials it used | Same run's outcome |
| --- | --- | --- |
| `aws/cloudformation.ts` | `maintenanceCredentials()` | ✅ deleted the stack |
| `aws/tagging.ts` (the tag sweep) | `operatorCredentials()` | ❌ auth-failed in **all 18+ regions** |
| `aws/deletion.ts` (residual engine) | `operatorCredentials()` | untested, same exposure |

`maintenance.ts`'s own header says **template v4 strips the operator user to assume-only**, and
lists the only two consumers that deliberately stay on that key: `sts.ts` hop 1 and `identity.ts`.
`tagging.ts` and `deletion.ts` were not on that list — they had been left behind. The key still
WORKS for AssumeRole (maintenance credentials derive from it, and CloudFormation succeeded) and is
DENIED for `tag:GetResources`. That is exactly "assume-only".

It mattered well beyond us: the tag sweep IS the mechanism's I4 audit, so leaves-no-trace
verification was blind on every v4 account, and the host's residual-deletion backstop sat in the
same position. The harness's advice — "fix the account's read access" — pointed at the customer,
where there was nothing to fix.

**Fixed in `agentspoppy`, and verified by reading `origin/main` rather than by trusting the merge:**

- `4bd2d0f` — `tagging.ts:59` and every client in `deletion.ts` now sign with
  `maintenanceCredentials()`; **zero** `operatorCredentials()` remain in either file.
- `cd40ed8` — `certify.ts` now treats a sweep it could not read as **UNVERIFIED** and **refuses to
  write a certificate** for it: *"an unverified run is not a pass: nothing was proven either way."*
  The failure mode that produced a hollow certificate can no longer produce one.
- `996daa4` — spec updated: only the setup gateway's *write* side stays on the key.

Both files are `SECURITY_MECHANISM.md` §4 enforcement points, so this took its own approval window
(the eleventh) in the platform repo. **Nothing here was patched from this repo, and nothing here
needs to be.**

### ✅ LEAVES NO TRACE — VERIFIED BY CONSOLE, in the production account (2026-09-11)

After the third hollow certificate, the question was settled with a **different instrument**. All
five resource types checked directly, in the region the poppy deployed into (`eu-west-1`) plus
global IAM, in the SAME account the certify run named — the sandbox was explicitly ruled out,
because this file records getting that wrong twice:

| Where | Looking for | Found |
| --- | --- | --- |
| CloudFormation | `AuditPoppyStack` | gone (only AgentsPoppy's own stack remains, as it should) |
| S3 | `auditpoppy-evidence-*` | gone |
| DynamoDB | `AuditPoppyStack-assessments` | gone |
| Lambda | `AuditPoppyStack-snapshot` | gone |
| IAM | `AuditPoppyStack-snapshot-role` | gone |

**Why this counts when three certificates did not:** CloudFormation, S3, DynamoDB, Lambda and IAM
are each their own source of truth. `tag:GetResources` is one index over all of them, and it is the
thing that was blind. Asking five services directly is not a weaker check than the sweep — on this
account it is the only check with any discriminating power at all.

**So the product claim stands, and the harness claim does not.** AuditPoppy leaves no trace: shown.
The `leaves-no-trace.cert.json` on disk says CERTIFIED on evidence that could not have said
anything else: still true, still the platform's to fix.

**The submission question this raises, and it is the founder's to decide:** reviewers read the
self-run certify report. Ours says CERTIFIED on a sweep we know was blind. Submitting it as proof
would be the exact move this repo keeps catching — *something that looks like proof, accepted
without asking what would have to be true for it to be proof* — only this time we would be the ones
doing it to a reviewer. Wait for the `certify.ts` fix and re-run; if the account's index lag means
the honest outcome is UNVERIFIED forever, submit that plus this console verification, and say so.

### 🚨 THE THIRD HOLLOW CERTIFICATE — and this time the cause is isolated (2026-09-11)

A run with everything right — fixed harness on `main`, preflight green, the stack deployed and
used, a snapshot in the bucket, and **98 minutes** of index warming — still printed
`footprint before: 0` and still certified.

**The isolating fact.** `footprintBefore` and the post-teardown residuals are the SAME call:
`service.getResiduals()` and `service.teardown()` both go to `this.cloud.findResiduals(c, account)`
(`service.ts:797` and the teardown body). One account, one query, minutes apart:

| When | What stood | Sweep returned |
| --- | --- | --- |
| before teardown | the whole tagged stack, up 98 min | **0** |
| after teardown | nothing | **2** ("couldn't be confirmed present") |

So the sweep is NOT denied any more — `4bd2d0f` worked. The Resource Groups Tagging index in that
account is simply lagging by **more than an hour and a half**, and only indexed the resources
around the time they were deleted. Which means `footprint before` may never be non-zero there, and
waiting longer is not obviously the answer.

**And the guard failed open.** `certify.ts:128` asks CloudFormation what stands, precisely because
it is a different system from the index — then:

```js
.catch(() => [] as string[]);
if (standing.length > 0) { /* warm up, re-sweep, else UNVERIFIED */ }
```

An inventory read that cannot be completed becomes *"no stacks were standing"*, and the blind
sweep certifies. **An unknown defaulting to the reassuring answer — inside the code written to stop
that exact shape.** (Same family as `checksOn` and the hollow certificate it was meant to prevent.)
Which branch was taken on this run is not provable from the output; the failing-open is provable
from the source, and is worth fixing either way.

**`certify.ts` is a `SECURITY_MECHANISM.md` §4 enforcement point — not ours to patch.** Reported to
the agentspoppy session. The narrow change: a failed inventory read is itself grounds for
UNVERIFIED, never for a pass.

**What settles leaves-no-trace meanwhile: the console, not the index.** CloudFormation, S3,
DynamoDB, Lambda and IAM are a different system from `tag:GetResources`, and that is exactly what
made the 2026-09-07 manual check worth something. **When the instrument cannot see, read a
different instrument** — do not keep re-running the blind one.

### ⚠️ The 2026-09-10 certificate is SUPERSEDED — half of it was proven, and not the half that matters

```
footprint before: 0 resource(s)      ← the problem
stacks deleted:   AuditPoppyStack
teardown hook:    ran
residual sweep:   0 resource(s) still tagged
✓ CERTIFIED
```

**What that run DOES prove, and it is the thing four days were spent on:** `stacks deleted:
AuditPoppyStack`. The whole delete sequence — the Lambda permission, the bucket policy, the
table's polled confirm, and the seven-call IAM role teardown — completed under the HOST's
principal. The ten-action fix works end to end against a real account. That result stands.

**What it does NOT prove: that we leave nothing behind.** `footprintBefore` is
`service.getResiduals()` → `findResiduals()`, a plain tag sweep over `tag:GetResources` with **no
stack filtering** — its own comment says it "catches out-of-stack resources and partial-delete
leftovers alike". Our stack's resources ARE tagged (stack tags propagate). So `0` before teardown,
with a live stack standing, means **the sweep could not see them**. At the time that was read as
tag-index lag; the very next run showed the sweep was *denied*, on credentials that had not changed
between the two runs.

`residualsAfter` came from **that same sweep**, and `passed` was `residualsAfter.length === 0`. A
sweep that answered 0 when the true answer was "a whole stack" answers 0 for any reason at all.
**It had no discriminating power on that run, in either direction.** `teardown hook: ran` is not
independent evidence either — `certify.ts` computes it from whether a hook is DECLARED, never
whether it succeeded.

So the certificate sitting on disk is not evidence. `leaves-no-trace.cert.json` is gitignored and
the next passing run overwrites it; **the run that replaces it is the real one.**

**The re-run is now a genuine test, which it was not before.** With `cd40ed8` in place a blind
sweep can no longer be mistaken for a clean bill — it reports UNVERIFIED and writes nothing. That
makes `footprint before: <non-zero>` the discriminating result on the next run: it says the sweep
can see, which is the only thing that makes `residual sweep: 0` afterwards mean anything.

**Still let the index warm.** Deploy, use it, then leave it an hour before running certify, and
check `footprint before` is non-zero before trusting the pass. Cheap — the deployment simply sits
a little longer. Worth it because **the directory re-runs this same harness at submission**, and
discovering a real leftover there is worse than discovering it here.

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
- 🚨 **The listing needs an AgentsPoppy 0.3.20 release, and the reason is a customer-facing one
  (answered by the agentspoppy session, 2026-09-11).** The shipped host is **0.3.19**, tagged
  2026-09-04, which predates every teardown fix — the ten delete-time actions and the sweep/cleanup
  move onto the maintenance session. `MAINTENANCE_POLICY_STATEMENTS` lives in **broker code**, not
  the customer's account template ("they exist only as a session bound"), and AgentsPoppy's own
  removal path uses that session (`http.ts:354` → `service.teardown`). So on 0.3.19, **a customer
  who removes AuditPoppy from AgentsPoppy's own screen strands the stack** and is left with the
  evidence bucket, table, role and function, billing. Not AuditPoppy-specific: any poppy with a
  Lambda permission, an execution role, a bucket policy or a table hits the same wall, and on a
  v4 account the residual sweep reads nothing and the cleanup does nothing.
  **Submission is NOT blocked** — the platform re-run (MARKETPLACE M7) is not built yet, so the
  developer self-runs certify from the agentspoppy repo and reviewers read that report. Ours runs
  from `main`, i.e. fixed code, which is exactly what the preflight now enforces.
  **Ours to do, and done:** `LISTING.minHost = "0.3.20"`, test-pinned, documented in `LISTING.md`
  step 5. It lives on the CATALOG ENTRY (`directory.ts:70`), not in `extension.json`, so it is
  filled in at submission and is easy to forget — hence the pin. Without the release it stops the
  bad install with "update AgentsPoppy first"; with it, the gate simply passes.
  **Not ours:** cutting 0.3.20 from `main` (13 commits past 0.3.19; macOS notarization needs the
  founder's machine), and the release note telling users on the new template who removed a poppy
  since late August to check for leftovers, because the shipped build could neither see nor clean
  them.
- Next, in dependency order — **the whole listing chain is gated on certification, which is gated
  on the platform** (`LISTING.md` has the order and the two one-way steps):
  1. ~~phase-0 teardown~~ — done 2026-09-10;
  2. ~~the platform fixes~~ — **all merged 2026-09-10**: the ten delete-time actions (agentspoppy
     #1 and #2), then the blind-sweep pair (`4bd2d0f` credentials, `cd40ed8` harness). Nothing is
     waiting on the platform any more. **`npm run certify -- --yes` is next**, after deploy → start
     the audit → evidence stack → capture a snapshot → leave it an hour so the tag index warms, and
     **check `footprint before` is non-zero** before trusting the pass. After a failed run the stack
     sits in `DELETE_FAILED`: clear it from the poppy's own **Remove** tab, which runs as OUR
     session and can delete what the host could not;
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
