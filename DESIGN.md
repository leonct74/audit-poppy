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

## 1. What it is — and the wedge against Vanta

Vanta/Drata/Secureframe sell audit-readiness at **$10k–30k+/year**, and their architecture has
an irony at its core: **to prove you're secure, you grant a third-party SaaS read access to
your entire cloud.** That is exactly the trade AgentsPoppy exists to kill.

AuditPoppy does the AWS half of that job **inside the customer's own account**:

1. **No vendor in the evidence path.** Findings, evidence snapshots and reports live in the
   customer's own S3/DynamoDB. Olly Digital never sees a security posture, a resource name,
   or a finding. The pitch in one line: *compliance evidence that never leaves your cloud.*
2. **AWS does the heavy lifting.** AWS already ships the machinery Vanta resells a view of:
   **AWS Config** (resource recording + managed rules), **Security Hub** (CIS / AWS
   Foundational Security Best Practices checks), **AWS Audit Manager** (a prebuilt SOC 2
   framework with automatic evidence collection). AuditPoppy turns them on, scopes them,
   translates their output into auditor language, and packages the result. It is mostly
   orchestration + rendering — the same shape as MailPoppy's GuardDuty integration, scaled up.
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
2. **Continuous evidence collection.** Enable Audit Manager's SOC 2 framework assessment +
   keep Config/Security Hub running; a monthly (configurable) **snapshot Lambda** writes a
   dated, immutable evidence bundle (posture summary, control status, raw finding exports) to
   the customer's own **versioned S3 evidence bucket** — the "operating effectively over the
   audit period" record auditors actually need. Optional S3 Object Lock for tamper-evidence.
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
        │                              · Audit Manager SOC 2 assessment   (ledger-recorded)
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

Config, Security Hub and Audit Manager are **account-level services**, not stack resources.
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
  `config:Get/Describe/Select*`, `auditmanager:Get/List*`. No `iam:*` writes, no data-plane
  reads (it reads *about* buckets, never *from* them — no `s3:GetObject` outside its own
  evidence bucket). This distinction goes in the grant `reason` fields and the dossier.
- **Narrow WRITE**: its stack (`AuditPoppyStack*`), its bucket (`auditpoppy-*`),
  its table, and the service-enablement actions (`config:Put*`, `securityhub:Enable*`/
  `BatchEnableStandards`, `auditmanager:Create/Update*` on its own assessment), all
  attribution-tagged where AWS allows.
- The permission screen already presents this honestly ("N of M confined; the wide ones are
  read-only") and the risk rating will be what it is — the listing copy explains *why* wide
  read is the product, in the approval-preview `reason`s, not by fighting the rating.
- Validate both halves with `accessanalyzer validate-policy` + the service-reference scoping
  check (the [[aws-service-reference-scoping]] lesson) before any live run.

## 5. Frameworks & mapping

- **v1:** SOC 2 Trust Services Criteria (the market's ask) with the technical checks sourced
  from Security Hub's **CIS AWS Foundations** + **AWS FSBP** standards and Audit Manager's
  SOC 2 framework. The TSC↔check mapping table is versioned content in the repo — reviewed,
  test-pinned, and the single place a control's "why an auditor cares" prose lives.
- **Later:** ISO 27001 and PCI views are mostly re-mapping the same checks (Audit Manager has
  frameworks for both); multi-framework is a rendering feature, not new collection.

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
| Audit Manager | per resource assessment | $5–25/mo when assessing |
| Evidence bucket + Lambda | S3 + one invocation/month | cents |

Rule inherited from AGENTS.md §9 ("show the money"): no service is enabled silently, the
estimate is shown next to the toggle, and the Costs screen shows the actuals afterwards.

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
personal use"*; recommended final form names the product and the disqualifier:
**"AuditPoppy by Olly Digital — for personal use only, not licensed for business use"**).
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
and we know them by name from day one. Mechanics: self-declared headcount attestation at
registration (honor system, like Docker's employee line — the license terms make a false
attestation a license violation, no verification bureaucracy); grant is **manual at first**
(founder approves from the admin panel — the MailPoppy domain-comp precedent), automatable
later; **recommended: the grant renews annually** with a re-attestation, so the "under 10"
claim stays current as companies grow.

So the ladder, complete — and the watermark removal is the carrot at each step:

| Tier | Cost | Registration | Exports |
|---|---|---|---|
| Personal use / evaluation | free | none | watermarked |
| Company under 10 employees | free | **required — identity known, license granted** | clean |
| Company of 10+ | paid (§11.2) | account (checkout) | clean |

Rules: the license terms state all three lines in plain words in the listing and in-app; the
paid entitlement (AgentsPoppy first-party checkout, `kind=subscription`, per AWS account) and
the granted small-company entitlement both remove the watermark; **no other behavioural
difference** — every install is otherwise identical, which keeps the build simple and the
evaluation honest. No technical anti-tamper: the code is source-available, a determined user
can strip a watermark, and the enforcement is the license terms plus the professional
context — build no DRM. Cancellation via the built-in billing portal like every first-party
product. Web-side work item: a small registration/request form + admin grant flow, reusing
the existing AgentsPoppy account and entitlement plumbing.

**Price (still open, §11):** recommendation **~$499/yr** per AWS account. Compliance budgets
are the richest in software; at $499/yr it undercuts Vanta ~95% while still reading as a
serious product — $14.99 would cost credibility, not gain adoption.

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
| Audit Manager / Security Hub regional gaps | region picker limited to supported regions (MailPoppy SES precedent) |
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
2. **Pricing** — accept the $499/yr recommendation, or position higher ($999/yr)?
3. **Licensing model — DECIDED (founder, 2026-09-02): three tiers.** Personal/evaluation
   free with watermarked exports; **companies under 10 employees free with mandatory
   registration on the AgentsPoppy website** (identity known, license granted, clean
   exports); 10+ employees paid. No feature-gated freemium. Full rules in §8, including
   the recommended watermark wording ("…not licensed for business use"), the annual
   re-attestation recommendation, and the no-DRM rule.
4. **Policy pack in v1** — include (recommended; it is half the perceived value) or defer?
5. **The Host-enforced machine declaration** — agree AuditPoppy should be the first
   poppy to wear the enforced chip (worth sequencing work for)?

## 12. Phase plan

0. **De-risk (small, live):** one throwaway account — enable Config+Security Hub+Audit
   Manager by API, read findings/evidence by API, measure real costs for a week, verify
   teardown semantics (incl. "already enabled" detection). This is the phase-0 the whole
   cost/teardown story depends on.
1. Readiness scan + gap report (read-only; no stack) — shippable free tier.
2. The stack: evidence bucket + snapshot Lambda + continuous collection.
3. Policy pack + auditor export.
4. Checkout integration + listing (manifest carries `network` {aws-only, none, machine:
   aws-only} + its own `compliance` block; dossier pages cross-link both ways).

Implementation runs in a **separate session** (per project convention), starting with
phase 0, against this document.
