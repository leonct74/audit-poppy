/**
 * The option catalogue the Readiness setup form renders — and the SINGLE
 * source the helper prompt is generated from (AGENTS.md §9 rule 1: generated,
 * never hand-written, so form and prompt can't drift).
 */
import { STANDARD_LABELS } from "@auditpoppy/core";

export interface CheckServiceOption {
  id: "config" | "securityhub";
  label: string;
  what: string;
  caution: string;
}

export const CHECK_SERVICES: CheckServiceOption[] = [
  {
    id: "config",
    label: "AWS Config — the change record",
    what: "Records every configuration change in your cloud account. This is the evidence trail an auditor samples when they ask \u201cprove this was true all year, not just today\u201d, and several of the gap checks cannot run without it.",
    caution: "Billed per recorded change. It is turned on first — the audit needs it running.",
  },
  {
    id: "securityhub",
    label: "AWS Security Hub — the audit checks",
    what: `Examines your account against ${STANDARD_LABELS["cis-1.2.0"]} and ${STANDARD_LABELS["fsbp-1.0.0"]}, which is where the gaps in your report come from — each one mapped to the SOC 2 criteria an auditor will ask about.`,
    caution: "30-day free trial, then billed per check. The end date and the after-trial cost are shown before you enable, and the off switch lives on the Costs screen.",
  },
];

/** The poppy's non-negotiables, stated wherever plans are made (rule 2). */
export const HARD_RULES = [
  "AuditPoppy is read-only about your estate: it reports gaps, it NEVER changes or deletes the resources it reports on. Fixing stays in your hands.",
  "Nothing is enabled silently: each service shows its monthly estimate, computed from your account, before you approve it.",
  "Anything found already enabled is recorded as not-ours and is never touched, including at removal.",
  "Removal disables exactly what AuditPoppy enabled and deletes only its own stack and evidence bucket — after an export-first, type-to-confirm step.",
] as const;

export interface PolicyFieldOption {
  policyId: string;
  policyTitle: string;
  fieldId: string;
  label: string;
  suggestion?: string;
}
