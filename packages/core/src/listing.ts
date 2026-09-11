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
  /**
   * The catalog gate (the entry's `minHost`, not the manifest's — it lives on the catalog entry,
   * `directory.ts:70`). 0.3.20 is the first AgentsPoppy whose host-maintenance session can finish
   * deleting this poppy's stack.
   *
   * 0.3.19 (the shipped build, tagged 2026-09-04) predates every teardown fix: the ten delete-time
   * actions, and the tag sweep and residual-cleanup move onto the maintenance session. On it,
   * removing AuditPoppy from AgentsPoppy's OWN screen strands the stack in DELETE_FAILED and
   * leaves the bucket, table, role and function behind, billing — the one outcome a poppy whose
   * promise is "leaves no trace" cannot ship with. The gate turns that into "needs 0.3.20 or
   * newer, update AgentsPoppy first".
   *
   * Removal from AuditPoppy's own Remove tab was never affected: that runs as the poppy's own
   * session, which holds the actions. The gate is about the host's path, not ours.
   */
  minHost: "0.3.20",
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

/**
 * The CATALOGUE ENTRY — the fields agentspoppy.com's `/poppies/[slug]` page renders.
 *
 * There is no hand-written page for AuditPoppy and there should not be: that route is a template
 * driven entirely by the catalogue record. `tagline` becomes the HTML `<title>` (as
 * "AuditPoppy — <tagline>"), `description` becomes the meta description, the OpenGraph card and
 * the `SoftwareApplication` JSON-LD, and `dataStaysInYourCloud` is what renders the
 * "Nothing leaves your cloud" panel. So the SEO of that page IS this object.
 *
 * Everything here obeys the same three laws as the rest of the listing, and the test below walks
 * every string: no "compliant"/"certified" (only a CPA firm attests), "cloud" rather than the
 * provider's name outside proper nouns, and NO PRICE — the amount lives in the commerce database
 * and the page renders it live, so the founder can change it without touching a release.
 */
export const CATALOG = {
  slug: "auditpoppy",
  categoryLabel: "Security & compliance",
  platforms: ["any"] as const,
  ageRating: "everyone",
  /** Renders the green "Nothing leaves your cloud" panel — the whole wedge, in one boolean. */
  dataStaysInYourCloud: true,
  supportUrl: "https://github.com/leonct74/audit-poppy/issues",
  securityContact: "https://github.com/leonct74/audit-poppy/security/advisories/new",
  /**
   * "What you get", split by tier. Mirrors DESIGN §8: everything below is free for an individual
   * and for a company under ten people; above that the export loses its watermark under a licence.
   * The watermark is the ONLY difference — no feature is withheld, because a compliance tool that
   * hides your own evidence behind a paywall has already lost the argument it is making.
   */
  features: [
    {
      tier: "free",
      title: "Gap report against the Trust Services Criteria",
      description:
        "Turns on the checking services your cloud already offers (AWS Config, AWS Security Hub), reads every finding, and maps it to the criteria an auditor asks about — naming the control, the affected resources and what to do.",
    },
    {
      tier: "free",
      title: "Evidence collected every month, automatically",
      description:
        "A scheduled function writes a dated, immutable bundle into a locked-down bucket in your account. An auditor needs proof your controls operated across the period, not a screenshot from today.",
    },
    {
      tier: "free",
      title: "Policy pack, pre-filled from what is actually there",
      description:
        "Access control, change management, incident response, vendor management, data retention — pre-filled from your observed posture, with your own answers kept visibly separate from the facts it read.",
    },
    {
      tier: "free",
      title: "The auditor package, in one click",
      description:
        "Gap report, policies, evidence index and your notes, as a PDF and as JSON. On the personal tier the PDF carries a watermark.",
    },
    {
      tier: "free",
      title: "What it will cost, before you switch anything on",
      description:
        "A live-priced forecast for your own account, read from your provider's price list — because the continuous change recording that an audit requires is the real cost, and you should see it first.",
    },
    {
      tier: "free",
      title: "Removes itself completely",
      description:
        "One button takes away everything it created — the stack, the bucket, the schedule, the roles — and leaves what was already there untouched. Verified against a real account, not asserted.",
    },
    {
      tier: "paid",
      title: "Clean exports for companies of ten or more",
      description:
        "The same package without the watermark, under a licence tied to the cloud account being audited rather than to whoever paid — so it survives a reinstall or a new machine. Free for companies under ten people.",
    },
  ],
} as const;
