/**
 * Licensing (DESIGN §8 — DECIDED, founder 2026-09-02): personal-free,
 * business-paid, small-company free-with-registration. No feature gating, no
 * DRM — the ONLY behavioural difference a license makes is the watermark on
 * exported documents. In-app screens are never watermarked.
 *
 * The price is NEVER here (the pricing law): it lives in the commerce database
 * and reaches the UI only through the host bridge's purchaseInfo().
 */

/** The paid entitlement's product id in the AgentsPoppy commerce catalogue. */
export const BUSINESS_PRODUCT_ID = "auditpoppy-business";

/** Where a small company (under 10 employees) registers for the free grant. */
export const SMALL_COMPANY_REGISTRATION_URL = "https://agentspoppy.com/auditpoppy/small-company-license";

/**
 * The watermark every page of every exported document carries when unlicensed
 * (DESIGN §8's recommended final form — names the product and the disqualifier).
 */
export const WATERMARK_TEXT = "AuditPoppy by Olly Digital — for personal use only, not licensed for business use";

/** The three tiers, in plain words (shown in-app and in the listing). */
export const LICENSE_TIERS = [
  {
    id: "personal",
    name: "Personal use & evaluation",
    cost: "Free",
    registration: "None",
    exports: "Watermarked",
    detail:
      "Every feature, no time limit. Exported documents carry a personal-use watermark.",
  },
  {
    id: "small-company",
    name: "Company under 10 employees",
    cost: "Free",
    registration: "Required — register on the AgentsPoppy website so we know who you are",
    exports: "Clean",
    detail:
      "The business license is granted free to registered companies under 10 employees. Headcount is self-declared and re-attested annually; a false attestation is a license violation.",
  },
  {
    id: "business",
    name: "Company of 10 or more",
    cost: "Paid, per AWS account",
    registration: "AgentsPoppy account (checkout)",
    exports: "Clean",
    detail:
      "A yearly subscription through AgentsPoppy checkout. Cancel any time from the billing portal.",
  },
] as const;

/**
 * The one behavioural gate: are exports watermarked? `licensed` is true when
 * the host says the business entitlement (bought OR granted) is owned.
 */
export function exportsWatermarked(licensed: boolean): boolean {
  return !licensed;
}

/** The line the license terms state, USE-based (risk register: free-riding). */
export const LICENSE_LINE =
  "Business use requires a license. Using AuditPoppy's outputs externally — handing an export to your auditor, answering a customer's vendor-risk request — is business use.";
