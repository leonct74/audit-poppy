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

2. **The history is published too — and this one is not clean yet.** AuditPoppy goes public the
   way every poppy does: this repo's visibility is flipped, no mirror (the AgentsPoppy broker is
   the only repo that uses one, because its monorepo carries internal working state). That makes
   git history public along with the tip, and commits `264cd02` and `689c48f` still contain a
   real sandbox account id in `phase0-derisk.md` and `DESIGN.md` — redacted at the tip on
   2026-09-03, but a redaction is not a deletion. **The history must be rewritten before the
   switch is flipped**, once, while the repo is young and has one contributor. It is not in any
   commit message, only in file contents, so a text replacement across all commits is enough.

Before flipping the switch, re-run the check — over history, not just the tip:

```bash
git grep -nE "\b[0-9]{12}\b" $(git rev-list --all) -- '*.md' '*.ts' '*.tsx' '*.mjs' \
  | grep -v 111122223333
```

The tip is guarded automatically by `packages/core/src/naming.test.ts`, which walks the whole
repository — docs included — and fails on any 12-digit id that is not one of AWS's documented
example ids. History has no such guard; that check above is the one thing a human must run.

Anything security-sensitive about the PLATFORM (how the licence endpoints can be abused, what
was fixed, what risk was accepted) belongs in the private `agentspoppy-web` repo next to the
code it describes — see `docs/security-review-license-flow.md` there — never in this one.

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
- ✅ **Full build DONE (2026-09-02, phases 1–3 + the in-app half of 4 — DESIGN §12
  "Build state").** Monorepo green: 69 tests, typecheck, both bundles, manifest generated
  from `permissionSet()` and valid under the platform validator. Both laws are
  test-pinned repo-wide (`packages/core/src/naming.test.ts`).
- Next: phase-0 week-end readout (scheduled) → live verify in the sandbox (install,
  full loop, the machine-gate check, `npm run certify`) → platform-side items (commerce
  product, small-company registration flow, catalogue submission) — DESIGN §12 "What
  remains before listing".
