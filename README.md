# AuditPoppy

SOC 2 audit-readiness for your own AWS account, from inside your own AWS account — an
AgentsPoppy extension. Gap report mapped to the SOC 2 Trust Services Criteria, continuous
evidence collection into your own S3, a generated policy pack, and an auditor-ready export.
No vendor ever sees your security posture: *compliance evidence that never leaves your cloud.*

Not a certification — SOC 2 reports are issued only by a licensed CPA firm. AuditPoppy
prepares everything the auditor works from. See `DESIGN.md` (the source of truth).

## Layout

```
packages/core            pure domain logic (no AWS SDK): the TSC↔check mapping table,
                         gap report, enablement ledger, costs + free-trial rule, evidence
                         bundles, licensing/watermark, policy pack, PDF writer, and the
                         test-pinned naming & pricing laws
apps/desktop             the poppy frontend (Vite + React on the poppy design kit)
apps/desktop/extension.json   the manifest — GENERATED from the sidecar's permissionSet()
apps/desktop/node-sidecar     the confined node22 backend: baseline → enable (Config first,
                         then Security Hub), readiness read path, two-phase stack deploy,
                         costs, export, /teardown
lambdas                  the monthly snapshot Lambda (THE evidence collector)
```

## Build & dev loop

```bash
npm install
npm test                              # core (vitest) + sidecar (node:test) + frontend
npm run typecheck
npm run build                         # frontend → apps/desktop/dist, sidecar → node-sidecar/dist/index.cjs
npm run gen:manifest                  # regenerate extension.json from permissionSet()
npm run smoke -w @auditpoppy/desktop-sidecar   # the full loop against a mock AWS (see smoke/run-smoke.mjs for one-time /etc/hosts setup)
```

Install into the local AgentsPoppy (builds, then lays the extension into
`~/.agentspoppy/extensions/`; uses the platform's dev installer when the agentspoppy
repo is at `~/Projects/agentspoppy` or `$AGENTSPOPPY_REPO`):

```bash
npm run install:local     # then RELAUNCH AgentsPoppy and approve the connection
```

Developer mode without the host: `npm run dev -w @auditpoppy/desktop-sidecar` (uses your
`AWS_PROFILE` — the phase-0 sandbox loop) plus `npm run dev -w @auditpoppy/desktop`
(the Vite dev server proxies `/api` to the sidecar).

## The two laws (test-pinned in `packages/core/src/naming.test.ts`)

1. **Naming law:** no compliance or certification claims, ever — only a licensed CPA firm
   attests. The approved register is "audit-ready" / "evidence for your SOC 2 audit".
2. **Pricing law:** no dollar amount is hardcoded anywhere in the poppy — the license price
   lives in the commerce database; AWS prices are fetched live.
