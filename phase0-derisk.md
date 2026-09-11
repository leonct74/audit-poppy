# Phase 0 — live de-risk log

> This repository is intended to become public. Account ids, IAM user names and CLI profile
> names are therefore kept OUT of it — not because they are secrets, but because an account id
> is the seed for cross-account role probing, bucket-name guessing and support-desk social
> engineering, and it buys a reader nothing. The findings below are the point; the account they
> came from is not.

Run against a private sandbox account in region **eu-west-1**, started 2026-09-02, using a
dedicated CLI profile. Everything here ran against real AWS.

## Baseline (the "found enabled, not ours" test data)

All three candidate services confirmed OFF before any change:

- `configservice describe-configuration-recorders` → `[]`
- `securityhub describe-hub` → `InvalidAccessException: not subscribed`
- `auditmanager get-account-status` → `INACTIVE`

So in THIS account every enablement is ours, and teardown may disable everything it
enabled. The poppy must capture exactly this baseline per account before enabling anything.

## 🚨 Finding 1 (design-changing): AWS Audit Manager is closed to new accounts

`auditmanager register-account` →

> AWS Audit Manager is now in **maintenance mode**. As of **April 30, 2026**, you cannot
> enable Audit Manager for new accounts or in additional AWS Regions.

Every AuditPoppy customer is a "new account" for Audit Manager, so it is **out of the
architecture entirely** (DESIGN §1.2/§2.2/§5 updated the same day): the snapshot Lambda is
THE evidence collector, and the SOC 2 ↔ check mapping is fully repo-owned. Had we built
first and de-risked later, this would have been discovered in a customer's account.

## Finding 2 (CORRECTED): the InvalidRoleException meant exactly what it said

First written up as "Config validates a fresh SLR with minutes of lag — retry with
backoff". **That was wrong.** The real cause: the recorder JSON was generated in a **zsh
heredoc**, where `$ACCT:role` triggers zsh's `:r` history modifier — it silently ate the
`:r`, producing an ARN whose `:role` had become `ole` — `arn:aws:iam::<id>ole/…`.
Config rejected a genuinely malformed
ARN for 40 minutes while I theorized about propagation. With the ARN correct,
`put-configuration-recorder` succeeded **instantly, first try — no SLR lag was observed
at all** (SLR created 09:26, correct call succeeded 10:12, but a correct call was never
made earlier, so no lag claim can be based on this run).

Lessons that DO survive:
- **Read the payload before theorizing.** "The role arn passed is not valid" was a
  precise, honest error; 40 minutes of backoff engineering answered a bug that a single
  `cat recorder.json` would have shown.
- Never build AWS ARNs through shell string interpolation in the poppy; the sidecar
  builds requests as typed SDK objects, which makes this class of corruption impossible.
- The delivery-channel S3 bucket needs the three-statement bucket policy
  (PermissionsCheck `GetBucketAcl` + ExistenceCheck `ListBucket` + Delivery `PutObject`
  with `bucket-owner-full-control`, all pinned to `AWS:SourceAccount`). That part was
  correct and worked unchanged.
- CLI gotcha (still true): shorthand syntax can't express the recorder's nested booleans —
  use a JSON payload; the typed SDK is unaffected.

Config recorder + delivery channel + `start-configuration-recorder` → `recording: true`
(2026-09-02 10:12 CEST).

## Finding 3: Security Hub enables cleanly, with tags, defaults = CIS 1.2.0 + FSBP 1.0.0

`securityhub enable-security-hub --enable-default-standards --tags auditpoppy=derisk`
succeeded first try; `get-enabled-standards` → CIS Foundations v1.2.0 and AWS FSBP v1.0.0
both `PENDING` (standards take a while to become READY, and findings hours to first
generate — the poppy's readiness scan must show a "checks are warming up" state, not an
empty report). A newer CIS (v3.0) can be added via `batch-enable-standards` later; the
mapping table decides which standard versions v1 pins.

## Finding 4: enable ORDER matters — Config first, then Security Hub standards

With Config not yet recording, both enabled standards sit at `StandardsStatus: INCOMPLETE`
(Security Hub's Config-backed controls cannot enable without a recorder). The poppy's
enable flow must run **Config → wait recording → Security Hub standards**, and the UI must
render `INCOMPLETE`/`PENDING` as "checks are warming up", never as failure or as an empty
(= falsely clean) report.

## Finding 5: the gap report's read path, verified

`describe-standards-controls` returns exactly the gap report's input per control —
`ControlId`, `ControlStatus`, `SeverityRating`, `Title` (e.g. `ACM.2 ENABLED HIGH "RSA
certificates managed by ACM should use a key length of at least 2,048 bits"`) — paginated,
per standard subscription. Pair with `get-findings` (per-control results) and
`describe-compliance-by-config-rule` once checks have run.

## Enabled in the sandbox (to be measured for a week, then torn down)

| Resource | Id / name | Ours? |
|---|---|---|
| S3 bucket (Config delivery, tagged `auditpoppy=derisk`) | `auditpoppy-derisk-<account-id>` | ours |
| IAM SLR `AWSServiceRoleForConfig` | created 2026-09-02 | ours |
| Config recorder + delivery channel `default` | eu-west-1 | ours |
| Security Hub + CIS 1.2.0 + FSBP 1.0.0 | eu-west-1 | ours |

## Week-end checklist (run ~2026-09-09)

1. Cost check: Cost Explorer, filter services `AWS Config` + `Security Hub`, the week's
   spend → record here (feeds DESIGN §7's printed estimates).
2. Read-path probe under real findings: `securityhub get-findings` (filters, pagination),
   `describe-standards-controls` per standard (control statuses — the gap report's input),
   `configservice describe-compliance-by-config-rule`.
3. Teardown, in order, verifying each: `securityhub disable-security-hub` →
   `configservice stop-configuration-recorder` + `delete-delivery-channel` +
   `delete-configuration-recorder` → empty+delete the bucket →
   `iam delete-service-linked-role` (AWSServiceRoleForConfig). Then re-run the baseline
   probes and require the exact baseline answers back.

## CLOSED 2026-09-10 — with a named, deliberate residue

Torn down by hand in the console, in this order, each step confirmed by the founder before the
next: Security Hub (found already inactive) → Config **stop recording** → empty and delete the
`auditpoppy-derisk-…` bucket.

**Final state — nothing costs anything, and two inert objects remain:**

| Thing | State | Why |
|---|---|---|
| Cost, 09-02 → 09-10 | **$0.00** | Security Hub free trial + a near-empty account |
| Security Hub | off | was already inactive when checked |
| Config recording | **stopped** | this is what was metering; the bill stops here |
| Delivery bucket | **deleted** | emptied, then deleted |
| Config recorder + delivery channel (`default`) | **still there, stopped, free** | see below |
| `AWSServiceRoleForConfig` | still there | AWS refuses to delete it while a recorder exists |

### Finding 6: the AWS Config console cannot delete a recorder or a delivery channel

There is no Delete anywhere on Config → Settings — only Edit and Start/Stop recording. The pair
can be removed **only** through the API (`delete-delivery-channel`, then
`delete-configuration-recorder`). The founder has no CLI profile for the sandbox, so they stay.

Left deliberately, not forgotten: recording is stopped, so nothing meters and nothing is written.
The only consequence is log noise from a delivery channel pointing at a bucket that no longer
exists.

**This is a product argument, not just a chore.** A customer who turns Config on by hand and
later wants it gone cannot finish the job in the console — the undo simply is not there. AuditPoppy's
teardown does it through the API, which is why "we remove what we turned on" is a real promise
rather than a restatement of what the console already offers (DESIGN §3).

### What the $0.00 does and does not prove

It **does** confirm the free-trial story the product tells: a week of Security Hub on a small
account genuinely costs nothing, so the trial clock on the Costs screen is honest, and the "cents
per month for a small account" line holds.

It **does not** validate the printed estimate for a populated account — this sandbox had almost
nothing in it, and Config bills per configuration item recorded. Nobody should cite $0.00 as
evidence that AuditPoppy is free to run.

### Finding 7: what a REAL account costs — the estimate, live-priced (2026-09-10)

Read straight off the Costs screen in a production account of roughly **1,600 resources**, with
rates fetched live rather than from a built-in table:

| Line | ≈ per month | What drives it |
|---|---|---|
| AWS Config — the change record | **$15.78** | ~4,940 recorded changes + ~970 rule evaluations |
| AWS Security Hub — the audit checks | **$3.63** | ~3,630 checks across 121 controls |
| Evidence bucket + monthly snapshot | **$0.05** | the bucket, plus one Lambda run a month |
| **Total while enabled** | ****$19.46**** | |

Two things worth keeping. **Config is 81% of it** — the audit checks are nearly free by
comparison, and the expensive part is the change recording SOC 2 actually requires, so there is
no cheaper design hiding here. And **our own stack is a rounding error** at five cents: the
product's cost is almost entirely the customer's cloud provider billing them for their own
compliance data, which is exactly the story the Costs screen tells.

An estimate, not a bill — but computed from that account's real shape, which is the closest thing
to a real figure short of running it for a month.

**This section briefly said this was already closed, three messages earlier.** The founder was
asked to check the console for that bucket, reported not seeing it, and this file was updated to
"CLOSED" — then the bucket turned up. The check had been run in the PRODUCTION account — the one AuditPoppy was tested against and torn down on 09-07 — not the
sandbox. The question never said which account to look in, and the answer was taken as though it
had.

That is the same mistake as the one below, one layer up: a claim accepted without asking what
would have to be true for it to be proof. "I don't see the bucket" proves nothing until you know
which account the eyes were pointed at. **When a check spans two accounts, the account is part of
the question.**

### The scheduled removal below did NOT exist — and that is the finding worth keeping

The section this replaces claimed two scheduled tasks guaranteed the cleanup:
`auditpoppy-phase0-teardown` (09-09) and `auditpoppy-sandbox-deadman-check` (09-20), under the
heading *"nothing depends on memory"*. **Neither existed.** Listing the account's scheduled
routines on 2026-09-10 returned an empty set. The 09-09 task never fired because there was
nothing to fire, and the 09-20 "dead man" was never going to catch that.

The damage was small only because the footprint is small. The lesson is not:

- **A safety net written down is not a safety net.** This file asserted the tasks existed, in
  confident prose, and every later reader — including an assistant advising the founder to "do
  nothing, a reminder will fire" — took it on trust. Nobody checked, for eight days.
- **Write down how to VERIFY it, next to the claim.** For scheduled work: list the routines and
  see it. A claim that cannot be checked from the file that makes it will eventually be false and
  nobody will notice.
- This is the same shape as the worthless certificate (CLAUDE.md): a thing that *looks* like
  proof, accepted without asking what would have to be true for it to be proof.

### Still open, and not blocking anything

The **cost readout** (checklist item 1) was never captured. It is still available — Cost Explorer
keeps billing history after the resources are gone — and it would sanity-check DESIGN §7's
printed magnitudes against a real bill. Not urgent: the product fetches live prices through
`pricing:GetProducts` and does not depend on this number.
