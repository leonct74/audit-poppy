/**
 * The directory listing copy — one place, because it appears in three (the catalog entry, the
 * website, and the manifest) and they must not drift.
 *
 * Every string here is bound by the three laws and pinned by `listing.test.ts`, which runs the
 * same `checkCopy` the shipped UI is held to. That matters more here than anywhere else: this is
 * the text a buyer reads before they trust the product, and "SOC 2 compliant" in a listing is a
 * claim only a licensed CPA firm may make.
 *
 * THE TAGLINE CHANGED, AND WHY (2026-09-08). DESIGN §11.1 decided
 * "SOC 2 audit-readiness in your own AWS" on 2026-09-02, reasoning that it is also what search
 * matches. The cloud-neutral rule (§0a) arrived the NEXT DAY and nobody reconciled them: the
 * decided tagline fails this repo's own test. It now reads "in your own cloud".
 *
 * The search argument survives the change, which is why this was safe to settle rather than
 * escalate: proper nouns stay under §0a, so "AWS Config" and "AWS Security Hub" appear in the
 * description below and carry the same signal — with the added truth that the product is about
 * to grow past one cloud. Say so if you would rather have the original back; it is one line.
 */
import { APPROVED } from "./naming";

export const LISTING = {
  /** Never carries "SOC 2" — the name is neutral on purpose (DESIGN §11.1). */
  name: "AuditPoppy",
  /** The tagline is where the explicitness lives. */
  tagline: "SOC 2 audit-readiness in your own cloud",
  publisher: "Olly Digital",
  website: "https://agentspoppy.com/poppies/auditpoppy",
  repo: "https://github.com/leonct74/audit-poppy",
  /**
   * The long description. No price: the pricing law keeps every amount in the commerce database,
   * where the founder can change it without a release. No "compliant" or "certified" either —
   * what this sells is READINESS, and saying otherwise would be the one claim that discredits
   * the whole product to the buyer who knows the difference.
   */
  description: [
    "Get ready for your SOC 2 audit without shipping your infrastructure's secrets to anyone.",
    "",
    "AuditPoppy runs inside your own cloud account. It turns on the checking services your provider already offers (AWS Config and AWS Security Hub), reads what they find, and maps every result to the Trust Services Criteria an auditor actually asks about — so you get a gap report that names the control, the affected resources, and what to do about it.",
    "",
    "It then keeps collecting. A small scheduled function writes a dated, immutable evidence bundle into a locked-down bucket in your account every month, because an auditor needs proof your controls operated over the audit period, not just today.",
    "",
    "It writes the policies too — access control, change management, incident response, vendor management, data retention — pre-filled from what it can actually observe in your account, with your own answers kept visibly separate from the facts it read.",
    "",
    "When you are ready, one button builds the auditor package: the gap report, the policies, the evidence index and your notes, as a PDF and as JSON.",
    "",
    "The evidence never leaves your cloud. The developer receives none of it. And when you remove AuditPoppy it takes everything it created with it — the stack, the bucket, the schedule — and leaves what was already there exactly as it was.",
  ].join("\n"),
  /** Shown wherever the listing has room for a few lines rather than a page. */
  highlights: [
    "Runs in your own cloud account — evidence never leaves it",
    "Gap report mapped to the Trust Services Criteria, with the resources named",
    "Monthly evidence collection, so you can prove controls operated over the period",
    "Policy pack pre-filled from your real posture",
    "Auditor package as PDF and JSON, in one click",
    "Removes itself completely, and never touches what it did not create",
  ],
  /** Repeated verbatim from the naming law so the listing cannot drift from the product. */
  disclaimer: APPROVED.policyDisclaimer,
} as const;
