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

/** Where a small company registers for the free licence. */
export const SMALL_COMPANY_REGISTRATION_URL = "https://agentspoppy.com/auditpoppy/small-company-license";

/** This poppy's id, as the platform's commerce plane knows it. */
export const POPPY_ID = "com.auditpoppy.desktop";

/** The platform origin the TAB may call (the Feedback tab already does — exempt by contract). */
export const PLATFORM_ORIGIN = "https://agentspoppy.com";

/**
 * The signup URL with the cloud account prefilled, so nobody has to copy an id by hand.
 */
export function registrationUrlFor(cloudAccountId: string | null | undefined): string {
  return cloudAccountId ? `${SMALL_COMPANY_REGISTRATION_URL}?account=${encodeURIComponent(cloudAccountId)}` : SMALL_COMPANY_REGISTRATION_URL;
}

/**
 * Where the app asks "is this CLOUD ACCOUNT licensed?" — the platform's cross-install
 * entitlement lookup, keyed by `target` rather than by the anonymous per-install buyer id.
 *
 * This is what makes a granted licence durable. The host's own `isPurchased` always sends the
 * install's buyerId, which lives in local storage: reinstall AgentsPoppy or AuditPoppy and that
 * id is regenerated, so an install-keyed licence would silently lapse and the watermark would
 * come back with no explanation. The account id doesn't move — and it is what the paid tier is
 * priced per anyway.
 */
export function accountEntitlementUrl(cloudAccountId: string, origin = PLATFORM_ORIGIN): string {
  const params = new URLSearchParams({
    poppyId: POPPY_ID,
    productId: BUSINESS_PRODUCT_ID,
    target: cloudAccountId,
  });
  return `${origin}/api/entitlement?${params.toString()}`;
}

/**
 * The watermark every page of every exported document carries when unlicensed.
 *
 * It names the product and the ONE disqualifier, and nothing else. The earlier wording opened
 * with "for personal use only", which stopped being true when the ladder was rewritten (founder,
 * 2026-09-03): the free row is where a 500-person company's evaluation starts, not a personal
 * tier. A watermark that mislabels its own reader as a hobbyist tells an enterprise evaluator
 * the product is not for them — the exact mistake the tier names were fixed to avoid — while
 * "not licensed for business use" already says everything the mark has to say.
 */
export const WATERMARK_TEXT = "AuditPoppy by Olly Digital — not licensed for business use";

/**
 * The ladder, in three lines (founder, 2026-09-03): full access for everyone
 * with a watermark; individuals and companies up to 10 people take the
 * watermark off by signing up; above 10 people, by subscribing.
 *
 * The first row is deliberately NOT named "personal": it is where every
 * evaluation starts, a 500-person prospect included, and naming it after the
 * smallest user of it told an enterprise either "not for us" or "we are
 * already in breach".
 */
export const LICENSE_TIERS = [
  {
    id: "everyone",
    name: "Everyone",
    cost: "Free",
    registration: "Nothing to do",
    exports: "Watermarked",
    detail: "Full access to every feature, at any company size, with no time limit.",
  },
  {
    id: "small-company",
    name: "Individuals & companies up to 10 people",
    cost: "Free",
    registration: "Sign up",
    exports: "Clean",
    detail: "Sign up on the AgentsPoppy website and the watermark comes off. Headcount is self-declared, re-attested each year.",
  },
  {
    id: "business",
    name: "Companies of more than 10 people",
    cost: "Subscription, per cloud account",
    registration: "Checkout",
    exports: "Clean",
    detail: "Subscribe and the watermark comes off. Cancel any time from the billing portal.",
  },
] as const;

/**
 * The one behavioural gate: are exports watermarked? `licensed` is true when
 * the host says the business entitlement (bought OR granted) is owned.
 */
export function exportsWatermarked(licensed: boolean): boolean {
  return !licensed;
}

/** The whole model, in one sentence — the headline of the Export screen. */
export const EVALUATION_LINE =
  "Full access for everyone, free. Exported documents carry a watermark until you take it off — by signing up (up to 10 people) or subscribing (more than 10).";

/** The small print under it: USE-based (risk register: free-riding). */
export const LICENSE_LINE =
  "Business use requires a license — handing an export to your auditor, or answering a customer's security questionnaire with it, is business use.";
