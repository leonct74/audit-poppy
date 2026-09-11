# Getting AuditPoppy into the directory

The copy itself lives in `packages/core/src/listing.ts`, test-pinned against the three laws —
edit it there, never here, or the two drift and the tests only guard one of them.

This file is the **order of operations**, because several steps depend on each other and two of
them are one-way.

## The chain

1. **Certification must pass first.** `npm run certify -- --yes`. The release runbook gates on it
   and the directory re-runs the same harness at submission, so a listing built before it is a
   listing built on a guess. **Currently blocked on the platform** — see CLAUDE.md; the host's
   maintenance session cannot delete three of this stack's resource types.

2. **Make this repository public.** Two separate things need it, which is why it is not just
   housekeeping:
   - The directory requires `repo` on every entry — the open-repo rule *is* the audit
     affordance, and a 404 defeats the purpose of having one.
   - `bugsUrl` in the manifest already points at this repo's issues, and §9a requires a public
     tracker. It 404s for everyone but the owner until the flip.

   **Before flipping, run the history check in CLAUDE.md.** The tip is guarded by a test; history
   is not, and publishing is not undoable.

3. **Pack.** `npm run pack`. It prints the sha256 and a ready-to-paste catalog entry with two
   `<FILL>` fields. The sha256 *is* the trust story — the broker verifies it locally before
   anything lands on a user's disk — so pack from a clean tree, at the exact commit you release.

4. **Publish the zip as a GitHub Release on this repository.** Packages live in the poppy's own
   repo, not on AgentsPoppy's infrastructure: the platform hosts kilobytes of catalog and the
   bytes come from here. Hosting is untrusted by design, which is what makes step 3's hash the
   thing that matters.

5. **Fill the catalog entry** from `listing.ts` and the release: `id, name, tagline, description,
   publisher, website, repo, version, minHost`, and `packages: { "any": { url, sha256 } }`. The
   platform key is `any` because this poppy's backend is a `node22` bundle rather than a native
   binary — one package, every machine.

   **`minHost` is not optional and it is `LISTING.minHost` (0.3.20).** It lives on the catalog
   entry, not in `extension.json` — the host reads it there (`directory.ts:70`) and refuses the
   install with *"needs AgentsPoppy 0.3.20 or newer — update AgentsPoppy first"*.

   Why that exact version: the shipped host is **0.3.19**, tagged 2026-09-04, and it predates every
   teardown fix — the ten delete-time actions, and the tag sweep and residual cleanup moving onto
   the maintenance session. On 0.3.19, a customer who removes AuditPoppy from **AgentsPoppy's own
   screen** strands the stack in `DELETE_FAILED` and is left with the evidence bucket, the table,
   the role and the function, still billing. For a poppy whose whole promise is that it leaves no
   trace, that is the one shipping outcome worth blocking an install over. (Removal from
   AuditPoppy's own **Remove** tab was never affected — it runs as the poppy's own session, which
   holds the actions. The gate is about the host's path, not ours.)

   So the listing depends on an AgentsPoppy **0.3.20** release, which is the founder's to cut
   (macOS notarization needs his machine). The gate is worth setting either way: without the
   release it stops the bad install, and with it the gate simply passes.

6. **Submit through the developer portal.**

## Already done, and why it does not need doing again

The runbook's "click-test the packed build in the real host" is **satisfied** (checked
2026-09-10). The packed zip was unzipped and compared against what `install-dev-extension.mjs`
lays out from the same build: the **same six files, byte-identical hashes** on the manifest, the
backend bundle and the frontend entry. The packer selects nothing different — so the build that
has been running against a real account for days IS the packed build, and clicking through it
again proves nothing new.

That also settles `machine: "aws-only"`, which is the part of that step with teeth. The host
refuses undeclared connections on the real spawn path, and every screen has run there: start the
audit, deploy the stack, capture a snapshot, build the export, render the policies, fetch live
prices, tear down. Nothing was refused.

**What is still unproven is the DIRECTORY install path** — download, verify the catalog sha256,
extract, register — because it cannot run until a catalog entry exists, which needs steps 2–5
above. That is not a separate check to schedule; it is the first real install after submission.

## The two one-way steps

Making the repository public, and publishing a release. Everything before them is reversible;
neither of them is. Do steps 1 and the history check before either.

## What the version string means

The version in `extension.json` is the **entire** update signal — the host compares it and
nothing else. Bump it for every release, and never widen the permission set as a side effect of
one: a user approved the grants they were shown, and a silent widening is the thing the whole
approval screen exists to prevent.
