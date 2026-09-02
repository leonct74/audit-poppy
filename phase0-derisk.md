# Phase 0 — live de-risk log

Sandbox account **REDACTED-ACCOUNT-ID** (`REDACTED-IAM-USER` IAM user, profile
`REDACTED-PROFILE`), region **eu-west-1**. Started 2026-09-02. Everything here ran
against real AWS; commands are reproducible with that profile.

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
`:r`, producing `arn:aws:iam::REDACTED-ACCOUNT-IDole/…`. Config rejected a genuinely malformed
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
| S3 bucket (Config delivery, tagged `auditpoppy=derisk`) | `auditpoppy-derisk-REDACTED-ACCOUNT-ID` | ours |
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

## Scheduled removal — nothing depends on memory (2026-09-02)

Two scheduled tasks exist in the founder's Claude app (Scheduled section in the sidebar):

1. **`auditpoppy-phase0-teardown`** — fires **2026-09-09 09:00**: cost readout, findings
   probe, full teardown, baseline verification, log + design update.
2. **`auditpoppy-sandbox-deadman-check`** — fires **2026-09-20 09:00**: independent
   verification that the sandbox is at baseline; if anything is still enabled (the 09-09
   task failed or never ran), it tears it down itself and reports.

Security Hub's free trial ends ~2026-10-02, so the dead-man check leaves 12 days of slack.
Scheduled tasks run when the app is open (an overdue task fires on next launch) — with the
app in daily use, both windows are safe by weeks.
