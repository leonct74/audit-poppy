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

## Finding 2: Config's fresh service-linked role validates with minutes of lag

- The delivery-channel S3 bucket needs the three-statement bucket policy
  (PermissionsCheck `GetBucketAcl` + ExistenceCheck `ListBucket` + Delivery `PutObject`
  with `bucket-owner-full-control`, all pinned to `AWS:SourceAccount`).
- `iam create-service-linked-role --aws-service-name config.amazonaws.com` returns
  immediately, `iam get-role` sees it immediately, `simulate-principal-policy` says
  PassRole is allowed — and `put-configuration-recorder` still throws
  `InvalidRoleException: The role arn passed is not valid` for **minutes** afterwards.
  Not IAM propagation in the usual sense: Config's own validation lags the SLR.
  **The poppy's enable flow must retry with backoff (≥4 min budget), never fail on the
  first InvalidRoleException.**
- CLI gotcha: shorthand syntax can't express the recorder's nested booleans
  (`recordingGroup={allSupported=true}` arrives as strings) — use a JSON payload; the SDK
  equivalent is unaffected.

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
