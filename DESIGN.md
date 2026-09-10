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

**Built as a SCREEN on 2026-09-07, five days late.** `/teardown` existed from day one because
the host calls it on uninstall, and everyone — including the tests and the smoke loop, which
drive the route directly — mistook that for the feature being done. Nothing in the app ever
called it: a user could stop the audit but had no way to remove the bucket, stack and table
short of uninstalling the extension, and the founder went looking for the button and found
none. The lesson generalises past this bug: **a route the tests can reach is not a feature the
user can reach**, and every acceptance check here drove the backend. The removal panel now sits
on the Costs screen under the off switch — the two ways out, in the place someone looks for
either — and enforces both of the safeguards above: it will not arm until the package has been
exported or the user explicitly says they do not want it, and the confirmation names the cloud
account so nobody removes from the wrong one.

**And it still left two roles behind (live teardown, 2026-09-07).** Everything else worked —
services off, stack deleted, bucket emptied and deleted — but both service-linked roles survived:
`iam:DeleteServiceLinkedRole` was refused on `arn:aws:iam::<account>:role/AWSServiceRoleForConfig`.
The delete call takes a role NAME and IAM authorizes against a **pathless** ARN, while
`CreateServiceLinkedRole` authorizes against the full `aws-service-role/<service>/` path. Creation
was permitted all week; deletion never could have been. Both forms are granted now, each still
naming exactly one role, and pinned by a test — because "leaves no trace" is the promise
certification measures and an orphaned role breaks it.

The teardown design earned its keep here: every step runs under `attempt()`, so the two failures
were **recorded and reported** while the rest of the removal completed, rather than aborting
half-way and leaving the bucket behind as well. A removal that stops at the first error is worse
than one that finishes and tells you what it could not do.

**A PLATFORM dependency this poppy cannot route around (2026-09-07).** Certification failed with
the stack in `DELETE_FAILED`: CloudFormation deletes an `AWS::Lambda::Permission` by calling
`lambda:RemovePermission`, and the host's maintenance session — which is what certify deletes
stacks with, not the poppy's own session — is granted only `lambda:ListTags` and
`lambda:DeleteFunction`. AuditPoppy's own manifest DOES grant the action, which is why in-app
teardown succeeds while certification does not.

Every workaround was examined and rejected, and the reasoning is worth keeping because it is not
obvious: **IAM authorizes before the service looks at the resource**, so removing the permission
ourselves beforehand changes nothing — CloudFormation still calls `RemovePermission` and is still
denied. Deleting the function first fails the same way. Dropping the resource is not available
either: EventBridge invoking a Lambda requires a resource-based policy, and the role-based
alternative (`AWS::Scheduler::Schedule`) is not in the maintenance policy at all, which trades one
gap for a worse one. Removing the schedule would remove continuous evidence collection, which is
the product.

So the fix belongs in `agentspoppy` (`packages/broker/src/aws/maintenance.ts`), and it affects
**every poppy with a scheduled Lambda** — a shape the platform encourages. Until it lands,
certification of this poppy cannot pass. The signature to recognise: `DELETE_FAILED`, with the
principal in the error being `AgentsPoppyHost-maintenance` rather than `agentspoppy-<uuid>`.
**Read the principal first** — it says immediately whether a denial is the poppy's problem or the
host's.

**It is three actions, not one — corrected 2026-09-07 after a second failed cycle.** The first
reading named `lambda:RemovePermission` alone, off a grep that only looked at `lambda:` lines in
the maintenance policy. A retry then stuck on three resources at once, and each maps to an action
the policy does not carry:

| Resource that sticks | What CloudFormation calls | In the maintenance policy |
| --- | --- | --- |
| `AWS::Lambda::Permission` | `lambda:RemovePermission` | ✗ |
| `AWS::S3::BucketPolicy` | `s3:DeleteBucketPolicy` | ✗ — it has `DeleteBucket`, a different action |
| `AWS::DynamoDB::Table` | `dynamodb:DescribeTable`, polled to confirm the delete | ✗ — it has `DeleteTable`, not the poll |

**Confirmed by controlled comparison, 2026-09-07.** The founder removed the poppy from the app,
and it deleted the very stack certify had left in `DELETE_FAILED` — the Lambda permission, the
bucket policy and the table included — then emptied and deleted the evidence bucket and removed
both service-linked roles, with no problems reported. Same stack, same account, different
principal, different outcome. That isolates the missing actions rather than inferring them, and
`dynamodb:DescribeTable` isolates cleanly because BOTH principals hold `DeleteTable`.

The general shape, which is the part worth keeping: **CloudFormation deletes a stack with the
CALLER's credentials**, so the host's session policy has to cover every resource type any poppy's
template can create — not the types the platform happens to create itself. A policy assembled
resource-type by resource-type will keep acquiring holes as poppies ship new shapes; the durable
fix is to derive it from what templates are allowed to contain.

**The state this leaves behind is a dead end the product had to answer for.** A `DELETE_FAILED`
stack cannot be created over (AWS holds the name) and cannot be updated, so the Evidence screen's
"you can retry" was offering a button that could not work. Setup now says what is actually true
and sends the person to the removal screen — deliberately *not* finishing the delete itself,
because nothing in this template is `DeletionPolicy: Retain` (on purpose, so teardown leaves no
trace) and finishing it destroys the evidence bucket. That decision belongs behind the removal
screen's export gate and type-to-confirm, never behind a button labelled "set up". A create that
merely rolled back (`ROLLBACK_COMPLETE`) is the opposite case — the stack holds nothing, deleting
it is the documented remedy, and setup now does that for you.

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
- **Every grant carries a `reason`, writes included** (security review, 2026-09-07). The rule
  used to exempt anything scoped to our own stack, on the theory that a narrow grant explains
  itself. It does not: the approval screen shows a person "iam: CreateRole, DeleteRole,
  PutRolePolicy…" either way, and for a product whose pitch *is* legible permissions, having
  the writes be the unexplained ones was exactly backwards. Test-pinned.
- **Two grants removed in the same review**, both for the same reason — a permission nobody
  exercises cannot fail loudly when it is taken away, so it survives by inertia until someone
  finds a use for it that the approver never agreed to:
  - `lambda:InvokeFunction` — the monthly schedule invokes the snapshot function; EventBridge's
    permission to do so lives in the template, and nothing here ever calls it.
  - `iam:DeleteRolePermissionsBoundary` — the host attaches a boundary to the role our stack
    creates, and the platform's security spec has an outstanding step that makes that boundary
    mandatory. Holding this action would step around that fix in one call: create the role
    bounded, then strip the boundary. Putting a boundary *on* stays; taking one *off* is never
    AuditPoppy's to do. (A stack update that went from bounded to unbounded would now fail
    rather than succeed — the correct direction for a compliance tool to fail in.)

## 5. Frameworks & mapping

- **v1:** SOC 2 Trust Services Criteria (the market's ask) with the technical checks sourced
  from Security Hub's **CIS AWS Foundations** + **AWS FSBP** standards. The TSC↔check
  mapping table is **fully repo-owned**, versioned content — reviewed, test-pinned, and the
  single place a control's "why an auditor cares" prose lives. (It was going to lean on
  Audit Manager's prebuilt SOC 2 framework; phase 0 found that service closed to new
  accounts, so the mapping is ours outright — more work once, no deprecation hostage.)
- **Later:** ISO 27001 and PCI views are mostly re-mapping the same checks; multi-framework
  is a rendering feature, not new collection.

**Consolidated control findings, and the CIS join (live finding, 2026-09-06).** AWS reports ONE
finding per underlying security control, named FSBP-style (`IAM.4`) and associated with every
standard that contains it — there is no finding carrying `CIS.1.12`. A first live report showed
the consequence exactly: all 42 CIS controls "no data" while the same checks had results under
their FSBP names, and because this table is CIS-heavy, 42 of the 74 mapped controls were
permanently blank while the standard carrying every finding sat 81% unmapped.

The join is repo-owned data (`equivalence.ts`), not an API call: the pairing is stable published
fact, and keeping it here means it is reviewed like code and pinned by tests that run without
AWS — where an extra grant and an unverifiable response shape is precisely where this project's
live bugs have come from. The rule for adding a pair is that the two controls test the SAME
thing; an unpaired control stays honestly empty, because **a wrong pairing puts a false pass or
a false failure into a document destined for an auditor, which is worse than the blank it
replaces.** Where several CIS controls share one security control (the seven password rules all
roll into `IAM.7`), a PASS is inherited — `IAM.7` passes only when every rule passes — but a
FAILURE is recorded as a WARNING rather than asserting which rule broke. Everything inherited
carries `derivedFrom`, and the report says so on the row.

### The policy pack's one hard rule: a missing fact changes the SENTENCE (2026-09-07)

Found the first time the Policies screen ran against a real account. It listed 11 users, then
the per-user MFA read failed, and the Access Control policy rendered:

> "Current state, as observed in the cloud account: 11 user accounts, of which **not yet
> observed** lack MFA."

In a document written for an auditor. Two separate faults produced it, and both are fixed:

1. **The observation discarded what it had already learned.** The user count and the per-user
   MFA scan shared one `try`, so a single failing user threw away every user already counted and
   left nothing but a blank — with no way to find out why. Each user is now counted separately,
   the scan records how many it actually read, and the reason is carried in the user's words
   (never naming a user: that string reaches a document).
2. **"not yet observed" was a VALUE.** It reads fine on a chip and is a disaster inside a
   sentence. `observedValues()` now returns `undefined` for a fact it does not have, and section
   bodies carry conditionals — `{{#id}}…{{/id}}` and `{{^id}}…{{/id}}` — so the prose changes
   shape instead of splicing in a non-value. The chip still renders the "not yet observed"
   label, where it belongs.

And a partial scan is reported as a **floor, never a total**: "at least 1 lack MFA — that count
covers the 9 accounts we could check". Saying "1 lack MFA" when only 9 of 11 were read is a
false specific claim, which is the same mistake `inheritFindings` refuses to make when a shared
control fails. Over-claiming in an auditor's document is the one error worth engineering against
everywhere it can occur.

The renderer resolves conditionals in a LOOP, because one pass leaves nested blocks behind — the
outer match consumes the inner tags and a replaced body is never re-scanned. The first version
of this shipped a literal `{{#mfaCoverage}}` into the rendered text, which is exactly the class
of bug it was written to prevent.

### Nothing identifying may reach a document the customer hands out (2026-09-08)

The banner above worked: it named the cause on the next run. `iam:ListMFADevices` on AgentsPoppy's
own operator user is denied by the platform's `CannotTamperWithAgentsPoppy` guardrail —
`Deny iam:*` on the broker role, the operator user and the boundary policy. **That Deny is
correct and stays.** It is aimed at tampering and catches a read as a side effect, which costs
exactly one unreadable account, on every install, forever.

Two changes came out of it, and the second is the one that mattered.

**A Deny is an exclusion, not a fault.** Denied accounts are counted separately from failed ones,
so the count stays exact and the sentence explains why the numbers do not add up:

> "11 user accounts, of which 1 lacks MFA. One further account is the identity AgentsPoppy itself
> uses; AuditPoppy is deliberately not permitted to read it, and it is not a person's login."

No warning banner for it either — a permanent alarm about a working guardrail teaches people to
ignore alarms.

**The provider's error message was being rendered into the policy document.** The real one read
`User: arn:aws:sts::<account>:assumed-role/AgentsPoppyBroker/agentspoppy-<uuid> … on resource:
user <name> … Go to https://…/authorization-details/<id>` — an account id, a role name, a session
id, a user name and a console link, in a file a customer emails to an auditor. This repo has a
rule about identifying data in **its own files**, with a test that enforces it; the same care had
never been applied to the documents the product **produces**, which is the more consequential
direction by far.

The fix is classify-then-write: a failure becomes a plain sentence chosen from what kind of
failure it was, and a provider message is never passed through. `documentSafe()` strips ARNs,
account ids, URLs and authorization ids as a backstop, applied to every value entering prose —
and it is explicitly *not* a guarantee, because a bare IAM user name looks like any other word.
Belt and braces, with the belt being "do not put raw errors in documents at all".

### Removal gets its own tab (2026-09-10)

§3 put removal at the bottom of the Costs screen — next to the off switch and the bill, on the
reasoning that "someone looking for either looks here". That reads well and is wrong. The founder,
who specified that placement, went looking for it and could not find it **twice**: once on
2026-09-07 ("I don't see the tear down button") and again on 2026-09-10 ("remove from where????").

A destructive action nobody can find is not tucked away safely. The person hunting for it has
already decided; what they do instead — deleting things by hand in the console, or abandoning the
poppy installed — is worse than the button. So **Remove** is now a tab of its own, immediately
before the mandatory Feedback one, with a one-line pointer left on Costs for anyone who lands
there looking.

Both facts are pinned by `tabs.test.ts`, which also caught what the change nearly cost: nothing
enforced "Feedback is the LAST tab" — a listing requirement, not a preference — and inserting a
tab beside it was one character away from making the poppy unlistable with no test to notice.

## 6. Privacy & threat model (the honest paragraph, up front)

Everything stays in the customer's account — but the *customer's own admins* can read the
evidence bucket, and the poppy's findings describe security weaknesses. So: the evidence
bucket is SSE + TLS-only + no public access (MailPoppy's §14 hardening list, reused); the
gap report's export warns it is sensitive; and the poppy's own compliance block declares
`subprocessors: []` — no user data, findings included, ever reaches the developer. The
in-app screens state the same in plain words.

**Three hardenings from the 2026-09-07 security review** (the whole poppy was reviewed, not
just a diff, because the repo is about to be published):

1. **The sidecar's loopback port now checks who is calling.** It read only method, path and
   body — no caller identity at all — while AGENTS.md is explicit that loopback is *not* a
   trust boundary, since every poppy's backend is a local process too. Any process running as
   the user could read the account id and every failing control, mint an export download
   token, or `POST /teardown` and destroy the versioned evidence bucket. It now refuses any
   request carrying an `Origin` header (only a browser sets one, and no legitimate caller here
   does) or whose `Host` is not loopback (which kills DNS rebinding). That closes the browser
   class completely; the local-process class needs a shared secret only the host can issue,
   and is filed as a platform request. `localOnly.ts` says what each half does and why.
2. **Every S3 call asserts the bucket's owner.** The evidence bucket's name is derived from the
   account id and S3's namespace is global, so the name is guessable and our own
   `arn:aws:s3:::auditpoppy-*` grant matches it in *any* account. Someone who pre-created that
   name in their own account could not have made us write into it through the shipped UI — the
   stack fails and the snapshot button is gated on a healthy stack — but the *read* path was
   ungated, so attacker-authored JSON would have been parsed and carried into the export handed
   to an auditor. Fabricated evidence in the deliverable is the worst outcome this product has.
   `evidenceBucketRef()` returns the name and `ExpectedBucketOwner` **as one value** so a call
   site cannot take one without the other, and a test reads the source to keep it that way.
3. **The paid licence is filed against the cloud account, not the buyer.** `buyProduct` was
   called with no `target`, so a purchase keyed on the install that paid — meaning a reinstall,
   or auditing the same account from a second machine, would silently lose a licence somebody
   paid for. That is precisely the failure §8's account key exists to prevent, and the Export
   screen already promised the opposite in words.

One race surfaced while re-running the smoke loop and was fixed with them: `/status` read the
persisted state *before* its network calls and reported `enableOp` *after* them, so a single
poll could say "enable finished" beside a trial clock that had not started. Rare, real, and a
UI would have seen it too.

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

**Show what is charged AT ONCE, not only per month (founder question, 2026-09-04).** Asked
whether a few minutes of testing would cost pennies, the honest answer is "that depends, and the
screen doesn't say". Cloud config recording bills per recorded item, not per hour: switching the
recorder on records one item for every recordable resource immediately, and turning it off five
minutes later does not avoid that. A screen showing only `$X/month` invites exactly the wrong
inference — on a 5,000-resource account the up-front sweep is dollars, not pennies. The estimate
therefore carries `initialUsd` alongside the monthly total and the Costs screen shows both, with
the same live/approx marker. Like every other figure here it is derived — live resource count ×
live unit price — never a stored number; `costs.test.ts` pins that it moves when either input
moves, which is what stops it silently becoming a hardcoded lie.

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

**The platform side of this flow was security-reviewed (2026-09-03).** Five findings, all
fixed, plus one accepted risk. The record lives with the code it describes — in the private
`agentspoppy-web` repo (`docs/security-review-license-flow.md`) — and deliberately not here:
this repository is intended to become public, and a public write-up of how a live licence
endpoint can be abused is a map, not documentation. What matters for THIS design is only the
outcome: the free-licence grant is constrained to an allowlisted (poppy, product) pair, so a
request made against this flow can never become an entitlement for something else.

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

0. **De-risk (small, live) — RUNNING (2026-09-02, a private sandbox in eu-west-1; log:
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

**Audited against AGENTS.md §10 and the release runbook on 2026-09-07**, with the platform's own
tooling rather than by reading. What that turned up:

- ✅ `validate-manifest` (the platform's, the same `parseManifest` the host runs): **valid** —
  27 grants, backend confined, all three network doors declared.
- ✅ **Packs with the directory's packer**: 3.0 MB, 6 files. Well under the "~100 MB+ means a
  runtime got in" line, and the sha256 came out identical across two independent runs, which is
  the deterministic-STORE-zip promise holding — the sha *is* the trust story.
- ✅ Costs show the `$0 — nothing running, nothing billing` state explicitly, not by implication.
- ✅ `requiredTags` carries `agentspoppy:connection`; both laws test-pinned; Feedback tab last;
  helper prompt present; naming carries the suffix.
- 🔧 **Two capabilities were declared and never called** — `connection:read` and `host:notify`.
  Removed, along with their bridge helpers so code and manifest agree. Same failure as the unused
  `lambda:InvokeFunction` grant: a manifest gets written from the shape of a manifest rather than
  from the calls that earn each line, and nothing breaks when an unused one is removed, so it
  survives. A test now reads the frontend source and fails both ways — declared-but-uncalled, and
  called-but-undeclared. It was verified to fail by re-adding one.
- 🔧 **`npm run pack` added.** The packer defaults `--backend` to `apps/desktop/backend/index.cjs`
  and our build writes `apps/desktop/node-sidecar/dist/index.cjs`, so the documented command dies
  with "built backend not found". `install-local.mjs` already knew the real path; the pack path
  did not. Same shape as the missing `certify` script, fixed the same way.
- ⚠️ **`bugsUrl` points at this repo's issues, and this repo is still private** — the link 404s
  for everyone but the founder, and §9a requires a *public* tracker. It resolves itself when the
  repo's visibility is flipped, which is planned anyway; it just has to happen **before**
  submission, not after.
- ❌ `certify` — blocked on the platform's three missing delete actions (§3 above), not on
  anything here.
- ⏳ **The founder's, and it cannot be done from a repo:** click-test the PACKED build in the real
  host (install-dev + full app restart). That is where `network.machine: "aws-only"` is actually
  proven — the host refuses undeclared connections on the real spawn path, so a wrong declaration
  shows up as a failed call in the poppy, never as a warning at pack time. Also: install it and
  read the permission screen, which must rate amber/green with no beyond-own findings.

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
