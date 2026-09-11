/**
 * CIS control → the security control that actually produces its finding.
 *
 * WHY THIS EXISTS. AWS moved to consolidated control findings: one finding per underlying
 * security control, named FSBP-style ("IAM.4"), associated with every standard that includes it.
 * There is no finding carrying "CIS.1.12". So a CIS-keyed report gets nothing — which is exactly
 * what a live account showed on 2026-09-06: all 42 CIS controls "no data", while the same checks
 * had results under their FSBP names.
 *
 * WHY IT IS DATA, NOT AN API CALL. Security Hub can be asked for these associations, but that
 * means a new grant, a new failure mode, and a response shape this repo cannot test offline.
 * The pairing is stable published fact, so it lives here: reviewed like code, diffable, and
 * pinned by tests that run without AWS.
 *
 * THE RULE FOR ADDING A PAIR. Only when the two controls test THE SAME THING. A wrong pairing
 * puts a false pass or a false failure into a document destined for an auditor, which is worse
 * than the blank it replaces — so an unpaired CIS control stays honestly empty. That is why the
 * alarm controls (CIS.3.x) and the CloudTrail-bucket ones are absent: their counterparts are
 * real but are not in this repo's mapping table yet, and a guess is not a mapping.
 */

export interface ControlEquivalence {
  /** The CIS 1.2.0 control id, as Security Hub reports it. */
  cis: string;
  /** The security control whose finding covers it. */
  securityControl: string;
  /**
   * True when SEVERAL CIS controls share this one security control — the seven password-policy
   * rules all roll up into IAM.7. It changes what may be inferred: see `inheritFindings`.
   */
  shared?: boolean;
}

export const CIS_EQUIVALENTS: ControlEquivalence[] = [
  // --- Identity ---
  { cis: "CIS.1.2", securityControl: "IAM.5" },
  { cis: "CIS.1.3", securityControl: "IAM.8" },
  { cis: "CIS.1.4", securityControl: "IAM.3" },
  // The seven password rules are one control in FSBP. Shared: a failure cannot be pinned on any
  // single rule.
  { cis: "CIS.1.5", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.6", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.7", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.8", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.9", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.10", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.11", securityControl: "IAM.7", shared: true },
  { cis: "CIS.1.12", securityControl: "IAM.4" },
  { cis: "CIS.1.14", securityControl: "IAM.6" },
  { cis: "CIS.1.16", securityControl: "IAM.2" },
  { cis: "CIS.1.22", securityControl: "IAM.1" },
  // --- Logging ---
  { cis: "CIS.2.1", securityControl: "CloudTrail.1" },
  { cis: "CIS.2.2", securityControl: "CloudTrail.4" },
  { cis: "CIS.2.4", securityControl: "CloudTrail.5" },
  { cis: "CIS.2.5", securityControl: "Config.1" },
  { cis: "CIS.2.7", securityControl: "CloudTrail.2" },
  { cis: "CIS.2.8", securityControl: "KMS.4" },
  { cis: "CIS.2.9", securityControl: "EC2.6" },
  // --- Networking ---
  { cis: "CIS.4.1", securityControl: "EC2.13" },
  { cis: "CIS.4.2", securityControl: "EC2.14" },
  { cis: "CIS.4.3", securityControl: "EC2.2" },
];

/** Deliberately unpaired, and why — so the next person does not "helpfully" guess one in. */
export const UNPAIRED_NOTES: Record<string, string> = {
  "CIS.1.1": "Root-account usage has no equivalent control in the mapped FSBP set.",
  "CIS.1.13": "Covered by IAM.9, which this repo's mapping table does not carry yet.",
  "CIS.1.20": "Covered by IAM.18, which this repo's mapping table does not carry yet.",
  "CIS.2.3": "The CloudTrail-bucket public-access check is CloudTrail.6, not yet mapped here.",
  "CIS.2.6": "The CloudTrail-bucket access-logging check is CloudTrail.7, not yet mapped here.",
};

/**
 * Fill in CIS controls from the security control that actually carries their finding.
 *
 * Only touches controls with NO result of their own — a real finding always wins. What may be
 * inferred depends on whether the pairing is shared:
 *
 *   one-to-one  → copy the result outright, and the resources it names.
 *   shared      → a PASS is sound (IAM.7 passes only when every password rule passes), but a
 *                 FAILURE is not attributable to any single rule, so it is recorded as a
 *                 WARNING rather than asserting a specific rule failed. Over-claiming a failure
 *                 in a document an auditor reads is the one mistake worth engineering against.
 *
 * Everything derived is marked `derivedFrom`, so the report can say where the answer came from
 * instead of implying the check ran under that name.
 */
export function inheritFindings<T extends { controlId: string; compliance: string; failedResources?: string[]; derivedFrom?: string }>(
  controls: T[],
): T[] {
  const bySecurityControl = new Map<string, T>();
  for (const c of controls) bySecurityControl.set(c.controlId, c);

  return controls.map((control) => {
    if (control.compliance !== "NO_DATA") return control;
    const pair = CIS_EQUIVALENTS.find((e) => e.cis === control.controlId);
    if (!pair) return control;
    const source = bySecurityControl.get(pair.securityControl);
    if (!source || source.compliance === "NO_DATA") return control;

    if (pair.shared) {
      if (source.compliance === "PASSED") {
        return { ...control, compliance: "PASSED", derivedFrom: pair.securityControl };
      }
      if (source.compliance === "FAILED") {
        return { ...control, compliance: "WARNING", derivedFrom: pair.securityControl };
      }
      return control;
    }
    return {
      ...control,
      compliance: source.compliance,
      ...(source.failedResources ? { failedResources: source.failedResources } : {}),
      derivedFrom: pair.securityControl,
    };
  });
}
