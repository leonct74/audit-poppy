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
      "Get audit-ready for your SOC 2 audit, inside your own AWS account — gap report, continuous evidence collection, policy pack, auditor export. Evidence never leaves your cloud.",
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
        "Security findings, audit evidence and policy documents about your AWS account — stored only in your own AWS account (your evidence bucket and table) and on your machine. The developer receives none of it.",
      subprocessors: [],
      securityContact: "https://github.com/leonct74/audit-poppy/security/advisories/new",
    },
    capabilities: [
      "aws:credentials",
      "connection:read",
      "backend:invoke",
      "host:openExternal",
      "host:notify",
      "commerce:purchase",
    ],
  };
}

const out = join(here, "..", "..", "extension.json");
writeFileSync(out, `${JSON.stringify(buildManifest(), null, 2)}\n`);
console.log(`wrote ${out}`);
