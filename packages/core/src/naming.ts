/**
 * The naming law (DESIGN §0) and the pricing law (DESIGN §8), as code.
 *
 * Nobody can sell a SOC 2 certificate — only a licensed CPA firm attests, about
 * an organization. Every word this poppy ships says what it is: audit-READY,
 * evidence FOR your audit. The forbidden phrases below are test-pinned across
 * the whole shipped source (naming.test.ts walks the repo), the same way the
 * platform dossier pins its copy.
 *
 * The pricing law: the price lives in the commerce database and is fetched
 * live; NO dollar amount may appear in poppy code, manifest, or copy. "$0" is
 * the one allowed literal — "nothing running, nothing billing" is a state, not
 * a price.
 */

/** Phrases that may never appear in shipped copy, with what to say instead. */
export const FORBIDDEN_PHRASES: { pattern: RegExp; instead: string }[] = [
  { pattern: /SOC\s*2\s*[-–]?\s*compliant/i, instead: '"audit-ready" / "evidence for your SOC 2 audit"' },
  { pattern: /SOC\s*2\s*[-–]?\s*certified/i, instead: '"audit-ready" — only a licensed CPA firm attests' },
  { pattern: /get\s+certified/i, instead: '"get audit-ready"' },
  { pattern: /SOC\s*2\s+certification/i, instead: '"your SOC 2 audit" — an audit yields a report, not a certification we can promise' },
  { pattern: /guarantee[sd]?\s+(a\s+)?(passing|successful)\s+audit/i, instead: "nothing — never promise an audit outcome" },
];

/** A dollar amount literal (the pricing law). "$0" alone is allowed. */
export const HARDCODED_PRICE = /\$\s?\d+(?:[.,]\d+)?/;

const PRICE_ALLOWED = /^\$\s?0(?:\.0+)?$/;

export interface CopyViolation {
  phrase: string;
  instead: string;
}

/** Check one blob of shipped copy/source against both laws. */
export function checkCopy(text: string): CopyViolation[] {
  const violations: CopyViolation[] = [];
  for (const { pattern, instead } of FORBIDDEN_PHRASES) {
    const m = text.match(pattern);
    if (m) violations.push({ phrase: m[0], instead });
  }
  const priceMatches = text.match(new RegExp(HARDCODED_PRICE.source, "g")) ?? [];
  for (const m of priceMatches) {
    if (!PRICE_ALLOWED.test(m)) {
      violations.push({
        phrase: m,
        instead: "fetch the price live (commerce products API / AWS pricing API) — never a hardcoded dollar amount",
      });
    }
  }
  return violations;
}

/** The approved register, for reuse in copy so wording stays consistent. */
export const APPROVED = {
  productLine: "SOC 2 audit-readiness in your own AWS",
  whatItSells: "evidence for your SOC 2 audit",
  mappedTo: "mapped to the SOC 2 Trust Services Criteria",
  policyDisclaimer: "These documents are guidance to adapt to your organization — not legal advice.",
} as const;
