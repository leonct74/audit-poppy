/**
 * Generate apps/desktop/extension.json from the sidecar's permissionSet() —
 * ONE source for what AuditPoppy asks for, so the manifest the host reconciles
 * and the grants the code relies on can never drift (the MailPoppy pattern).
 * A committed manifest + the parity test (manifest.test.ts) keep it reviewed.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP, permissionSet } from "../src/permissionSet";

const here = dirname(fileURLToPath(import.meta.url));

export function buildManifest() {
  return {
    id: APP.id,
    name: APP.name,
    version: "0.1.0",
    description:
      "Get audit-ready for your SOC 2 audit, inside your own cloud account — gap report, continuous evidence collection, policy pack, auditor export. Evidence never leaves your cloud.",
    icon: "frontend/auditpoppy-icon.png",
    bugsUrl: "https://github.com/leonct74/audit-poppy/issues",
    permissionSet: permissionSet(),
    frontend: { entry: "frontend/index.html" },
    backend: {
      entry: "backend/index.cjs",
      transport: "http",
      runtime: "node22",
      isolation: "strict",
    },
    teardown: { endpoint: "/teardown" },
    compliance: {
      dataHandled:
        "Security findings, audit evidence and policy documents about your cloud account — stored only in your own cloud account (your evidence bucket and table) and on your machine. The developer receives none of it.",
      subprocessors: [],
      securityContact: "https://github.com/leonct74/audit-poppy/security/advisories/new",
    },
    // ONLY what the frontend actually calls (AGENTS.md §10). `connection:read` and `host:notify`
    // were declared and never used — copied in with the shape of the manifest rather than earned
    // by a call. An unused capability is the same liability as an unused grant: it widens what a
    // person approves, and nothing fails when it is taken away, so it survives by inertia.
    // Pinned by manifest.test.ts, which reads the frontend source.
    capabilities: ["aws:credentials", "backend:invoke", "host:openExternal", "commerce:purchase"],
  };
}

const out = join(here, "..", "..", "extension.json");
writeFileSync(out, `${JSON.stringify(buildManifest(), null, 2)}\n`);
console.log(`wrote ${out}`);
