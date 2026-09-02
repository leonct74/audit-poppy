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

## The two laws that bind every word and grant

1. **Naming law (DESIGN §0):** never "SOC 2 compliant/certified" — only a licensed CPA firm
   attests. Copy says "audit-ready", "evidence for your SOC 2 audit". Test-pin it like the
   platform dossier does.
2. **Wide READ, narrow WRITE (DESIGN §4):** reads may be wide but must be enumerated and
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
- 🚧 **Phase 0 de-risk RUNNING unattended** (started 2026-09-02, sandbox REDACTED-ACCOUNT-ID /
  eu-west-1, profile `REDACTED-PROFILE`, log: `phase0-derisk.md`). Config + Security Hub
  are deliberately LEFT ENABLED to measure a week of real costs. **Do NOT disable, modify
  or tear down anything in the sandbox** — a scheduled task tears it down on 2026-09-09 and
  a dead-man check re-verifies on 2026-09-20. The sandbox's REAL findings are available now
  for testing the gap report (read-only).
- ▶️ **NEXT: the build, in this session.** Order (DESIGN §12 + the 2026-09-02 plan):
  (1) scaffold — manifest (wide-read/narrow-write grants with reasons, network
  {egress aws-only, machine aws-only}, its own compliance block), frontend/backend
  skeletons, pack pipeline, copied from the proven poppy patterns (traffic-poppy is the
  closest reference); (2) readiness scan + gap report — the repo-owned SOC 2↔CIS/FSBP
  mapping table + renderer, tested read-only against the sandbox's real findings;
  (3) the stack — evidence bucket + snapshot Lambda + enable flows carrying the phase-0
  lessons (Config before standards; warming-up states; typed SDK requests, never
  string-built ARNs; free-trial end date + off switch on every toggle); (4) policy pack +
  auditor export + watermark; (5) licensing — entitlement checks, the under-10 registration
  + admin grant on agentspoppy-web, the $499/yr product in the commerce db (NEVER hardcode
  a price); (6) listing — mechanical review (needs the compliance block), catalogue entry,
  and verify it genuinely earns the first Host-enforced machine chip.
- Next: phase 0 de-risk (DESIGN §12) — live-enable Config/Security Hub/Audit Manager in a
  throwaway account, measure real costs for a week, verify teardown semantics.
