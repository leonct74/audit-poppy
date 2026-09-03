/**
 * The policy pack (DESIGN §2.3): the written policies auditors require,
 * pre-filled from what the poppy can actually observe (the real IAM/MFA
 * posture, CloudTrail state), editable by the customer, exported as documents.
 *
 * Framed as templates + guidance, NOT legal advice (the MailPoppy
 * AdminPrivacyNotice precedent) — every generated document carries
 * `APPROVED.policyDisclaimer`. Observed facts and customer-entered statements
 * keep their registers distinct all the way into the export.
 */
import { APPROVED } from "./naming";
import type { ObservedPosture, Register, TscId } from "./types";

export interface PolicyFieldSpec {
  id: string;
  label: string;
  /** Who supplies the value: the platform observed it, or the customer types it. */
  register: Register;
  /** For customer-entered fields: a sensible starting suggestion, clearly theirs to edit. */
  suggestion?: string;
}

export interface PolicySectionSpec {
  heading: string;
  /** Body template; {{fieldId}} placeholders resolve from the field list. */
  body: string;
}

export interface PolicyTemplate {
  id: string;
  title: string;
  tsc: TscId[];
  purpose: string;
  fields: PolicyFieldSpec[];
  sections: PolicySectionSpec[];
}

const f = (id: string, label: string, register: Register, suggestion?: string): PolicyFieldSpec =>
  suggestion === undefined ? { id, label, register } : { id, label, register, suggestion };

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "access-control",
    title: "Access Control Policy",
    tsc: ["CC6"],
    purpose: "Who gets access to what, how it is granted, reviewed and removed.",
    fields: [
      f("companyName", "Company name", "customer-entered"),
      f("accessApprover", "Who approves access requests", "customer-entered", "The engineering lead"),
      f("reviewCadence", "How often access is reviewed", "customer-entered", "Quarterly"),
      f("iamUserCount", "User accounts in the cloud", "platform-observed"),
      f("usersWithoutMfa", "Console users without MFA", "platform-observed"),
      f("passwordPolicySummary", "Cloud password policy", "platform-observed"),
    ],
    sections: [
      {
        heading: "Purpose and scope",
        body: "This policy defines how {{companyName}} grants, reviews and removes access to systems and data, covering the cloud environment and the tools connected to it.",
      },
      {
        heading: "Access provisioning",
        body: "Access is granted on request, approved by {{accessApprover}}, following least privilege: people get the narrowest access that lets them do their job. Shared accounts are not used; the root (owner) account is reserved for tasks only it can perform.",
      },
      {
        heading: "Authentication",
        body: "Multi-factor authentication is required for console access. Current state, as observed in the cloud account: {{iamUserCount}} user accounts, of which {{usersWithoutMfa}} lack MFA. The account password policy: {{passwordPolicySummary}}.",
      },
      {
        heading: "Access review and offboarding",
        body: "Access is reviewed {{reviewCadence}}. When someone leaves or changes role, their access is removed or adjusted within one business day; credentials unused for 90 days are disabled.",
      },
    ],
  },
  {
    id: "change-management",
    title: "Change Management Policy",
    tsc: ["CC8"],
    purpose: "How changes to systems are proposed, reviewed, tested and rolled out.",
    fields: [
      f("companyName", "Company name", "customer-entered"),
      f("reviewProcess", "How changes are reviewed", "customer-entered", "Pull-request review by a second engineer"),
      f("deployProcess", "How changes reach production", "customer-entered", "Through the CI pipeline, after tests pass"),
      f("configRecorderState", "Cloud change recording", "platform-observed"),
    ],
    sections: [
      {
        heading: "Purpose and scope",
        body: "This policy defines how {{companyName}} manages changes to production systems, so every change is reviewed, traceable and reversible.",
      },
      {
        heading: "Change process",
        body: "Changes are proposed in version control and reviewed before merge: {{reviewProcess}}. They reach production via a repeatable process: {{deployProcess}}. Emergency changes follow the same path, expedited, and are reviewed after the fact.",
      },
      {
        heading: "Infrastructure change record",
        body: "Changes to cloud infrastructure are recorded continuously: {{configRecorderState}}. This record is retained as audit evidence.",
      },
    ],
  },
  {
    id: "incident-response",
    title: "Incident Response Policy",
    tsc: ["CC7"],
    purpose: "How security incidents are detected, triaged, handled and learned from.",
    fields: [
      f("companyName", "Company name", "customer-entered"),
      f("incidentOwner", "Who leads incident response", "customer-entered", "The CTO"),
      f("notifyTargets", "Who is notified, and when customers are informed", "customer-entered", "The founders immediately; affected customers without undue delay"),
      f("cloudTrailState", "Cloud activity logging", "platform-observed"),
    ],
    sections: [
      {
        heading: "Purpose and scope",
        body: "This policy defines how {{companyName}} responds to security incidents affecting its systems or data.",
      },
      {
        heading: "Detection",
        body: "Cloud account activity is logged and monitored: {{cloudTrailState}}. Alerts and anomalous findings are triaged by {{incidentOwner}}.",
      },
      {
        heading: "Response",
        body: "On a suspected incident, {{incidentOwner}} leads response: contain, assess impact, eradicate, recover. Notification: {{notifyTargets}}.",
      },
      {
        heading: "Post-incident",
        body: "Every incident gets a written post-mortem within five business days: what happened, impact, timeline, and the changes that prevent recurrence.",
      },
    ],
  },
  {
    id: "vendor-management",
    title: "Vendor Management Policy",
    tsc: ["CC9"],
    purpose: "How third-party services are assessed before use and reviewed after.",
    fields: [
      f("companyName", "Company name", "customer-entered"),
      f("vendorApprover", "Who approves new vendors", "customer-entered", "A founder"),
      f("vendorListLocation", "Where the vendor list is kept", "customer-entered", "The company wiki"),
    ],
    sections: [
      {
        heading: "Purpose and scope",
        body: "This policy defines how {{companyName}} assesses and monitors the third-party services it depends on, in proportion to the data they touch.",
      },
      {
        heading: "Assessment and approval",
        body: "Before adopting a vendor that will process company or customer data, {{vendorApprover}} reviews its security posture (its audit reports or security documentation) and the data it would receive. Approved vendors are recorded in {{vendorListLocation}} with what they process.",
      },
      {
        heading: "Review",
        body: "The vendor list is reviewed yearly: vendors no longer used are offboarded and their access revoked; material vendors are re-assessed.",
      },
    ],
  },
  {
    id: "data-retention",
    title: "Data Retention & Disposal Policy",
    tsc: ["CC6", "C1"],
    purpose: "How long data is kept, and how it is disposed of.",
    fields: [
      f("companyName", "Company name", "customer-entered"),
      f("customerDataRetention", "Customer data retention", "customer-entered", "For the life of the contract, deleted within 30 days of termination on request"),
      f("logRetention", "Log retention", "customer-entered", "12 months"),
      f("evidenceRetention", "Audit evidence retention", "customer-entered", "At least the audit period plus one year"),
    ],
    sections: [
      {
        heading: "Purpose and scope",
        body: "This policy defines how long {{companyName}} retains each class of data and how data is disposed of when no longer needed.",
      },
      {
        heading: "Retention",
        body: "Customer data: {{customerDataRetention}}. System and audit logs: {{logRetention}}. Compliance evidence collected for audits: {{evidenceRetention}}.",
      },
      {
        heading: "Disposal",
        body: "Data past its retention period is deleted from primary stores and expires from backups on their rotation schedule. Storage is encrypted, so decommissioned media cannot yield readable data.",
      },
    ],
  },
];

export interface RenderedPolicyField extends PolicyFieldSpec {
  value: string;
}

export interface RenderedPolicy {
  id: string;
  title: string;
  tsc: TscId[];
  disclaimer: string;
  fields: RenderedPolicyField[];
  sections: { heading: string; body: string }[];
}

/** Turn observed posture into the values the platform-observed fields carry. */
export function observedValues(posture: ObservedPosture): Record<string, string> {
  const pw = posture.passwordPolicy;
  const pwSummary = !pw || !pw.present
    ? "no account password policy is set"
    : `minimum length ${pw.minimumLength ?? "unset"}${pw.requireSymbols ? ", symbols required" : ""}${pw.maxAgeDays ? `, expires after ${pw.maxAgeDays} days` : ""}`;
  const trail = posture.cloudTrailEnabled
    ? `activity logging is enabled${posture.multiRegionTrail ? " in all regions" : " (in one region only)"}`
    : "activity logging is NOT enabled";
  return {
    iamUserCount: posture.iamUserCount === undefined ? "not yet observed" : String(posture.iamUserCount),
    usersWithoutMfa: posture.usersWithoutMfa === undefined ? "not yet observed" : String(posture.usersWithoutMfa),
    passwordPolicySummary: pwSummary,
    cloudTrailState: trail,
    configRecorderState: "configuration changes in this account are recorded continuously (enabled by AuditPoppy)",
  };
}

/**
 * Render one policy: observed fields from posture, customer fields from the
 * saved answers (falling back to the template's suggestion, still marked
 * customer-entered — the customer owns those words either way).
 */
export function renderPolicy(
  template: PolicyTemplate,
  posture: ObservedPosture,
  customerAnswers: Record<string, string>,
): RenderedPolicy {
  const observed = observedValues(posture);
  const fields: RenderedPolicyField[] = template.fields.map((spec) => ({
    ...spec,
    value:
      spec.register === "platform-observed"
        ? observed[spec.id] ?? "not yet observed"
        : customerAnswers[spec.id]?.trim() || spec.suggestion || "",
  }));
  const valueOf = new Map(fields.map((x) => [x.id, x.value]));
  const sections = template.sections.map((s) => ({
    heading: s.heading,
    body: s.body.replace(/\{\{(\w+)\}\}/g, (_, id: string) => valueOf.get(id) ?? `[${id}]`),
  }));
  return {
    id: template.id,
    title: template.title,
    tsc: template.tsc,
    disclaimer: APPROVED.policyDisclaimer,
    fields,
    sections,
  };
}
