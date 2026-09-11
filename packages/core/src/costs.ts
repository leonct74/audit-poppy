/**
 * Cost model (DESIGN §7, GuardDuty precedent): every service the poppy would
 * enable is itemized BEFORE consent, with a monthly estimate computed from the
 * account's actual resource count. Unit prices are an INPUT — the sidecar
 * fetches them live from the AWS Price List API (pricing:GetProducts) and only
 * falls back to the clearly-labelled approximate defaults when the live query
 * fails. Nothing here is a display string with a dollar amount; the UI formats
 * numbers at runtime.
 *
 * The free-trial rule (founder, 2026-09-02): where a service has a free trial
 * (Security Hub's 30 days), the UI must show the END DATE, the expected cost
 * AFTER it, and the disable switch next to that line. `freeTrial()` computes
 * the dates; the copy is built at runtime from its output.
 */

export interface UnitPrices {
  /** Per configuration item recorded (AWS Config). */
  configPerItem: number;
  /** Per rule evaluation (AWS Config). */
  configPerRuleEvaluation: number;
  /** Per security check (Security Hub, first tier). */
  securityHubPerCheck: number;
  /** Whether these came from the live Price List API or the approximate fallback. */
  source: "live" | "approx";
  currency: "USD";
}

/**
 * Approximate defaults, used ONLY when the live pricing query fails, and always
 * labelled "approx" in the UI (AGENTS.md §9: degrade honestly — never present a
 * built-in number as live). Magnitudes from AWS public pricing at design time.
 */
export const APPROX_UNIT_PRICES: UnitPrices = {
  configPerItem: 0.003,
  configPerRuleEvaluation: 0.001,
  securityHubPerCheck: 0.001,
  source: "approx",
  currency: "USD",
};

export interface AccountShape {
  /** Recordable resources (from live Describe/List counts before enabling). */
  resourceCount: number;
  /** Security Hub checks per month ≈ enabled controls × evaluations. */
  enabledControls: number;
}

/** How many configuration items a resource yields per month, on average.
 *  Config bills per recorded change; quiet accounts change little. */
export const CONFIG_ITEMS_PER_RESOURCE_PER_MONTH = 3;
/** Security Hub evaluates most controls at least daily. */
export const CHECK_RUNS_PER_MONTH = 30;
/** Config rules behind Security Hub controls re-evaluate on change + schedule. */
export const RULE_EVALUATIONS_PER_CONTROL_PER_MONTH = 8;

export interface CostLineItem {
  service: "config" | "securityhub" | "evidence";
  monthlyUsd: number;
  detail: string;
  source: UnitPrices["source"];
}

export interface CostEstimate {
  items: CostLineItem[];
  totalMonthlyUsd: number;
  /**
   * What enabling COSTS AT ONCE, before a month has passed.
   *
   * A monthly figure on its own is quietly misleading, and the founder made exactly the wrong
   * inference from it (2026-09-04): "if I run it a few minutes it's pennies, right?" AWS Config
   * does not bill for elapsed time — it bills per configuration item, and switching the recorder
   * on records one item for EVERY recordable resource in the account, immediately. On a small
   * account that really is pennies; on one with thousands of resources it is dollars, and it is
   * incurred whether the recorder runs for a month or is torn down five minutes later.
   *
   * So the estimate carries both numbers and the screen shows both. A compliance tool that
   * surprises someone with a bill has damaged the one thing it sells.
   */
  initialUsd: number;
  source: UnitPrices["source"];
}

/** Configuration items recorded the moment the recorder starts: one per resource. A shape of
 *  the service, not a price — the money still comes from the live rate it is multiplied by. */
export const CONFIG_ITEMS_PER_RESOURCE_INITIAL = 1;

/**
 * The poppy's own stack — one Lambda run and a few KB of S3 a month. This is the ONE dollar
 * figure not derived from a live rate, because there is no per-account query that would make it
 * more accurate than "cents". It is therefore always reported with source "approx", so the
 * screen marks it, and it is named here rather than sitting as a literal inside the function
 * where nobody would find it to check.
 */
export const EVIDENCE_STACK_MONTHLY_USD_APPROX = 0.05;

/** Round to cents for display math (the UI formats). */
const cents = (n: number): number => Math.round(n * 100) / 100;

export function estimateMonthlyCosts(shape: AccountShape, prices: UnitPrices): CostEstimate {
  const configItems = shape.resourceCount * CONFIG_ITEMS_PER_RESOURCE_PER_MONTH;
  const ruleEvals = shape.enabledControls * RULE_EVALUATIONS_PER_CONTROL_PER_MONTH;
  const config = cents(configItems * prices.configPerItem + ruleEvals * prices.configPerRuleEvaluation);
  const checks = shape.enabledControls * CHECK_RUNS_PER_MONTH;
  const securityhub = cents(checks * prices.securityHubPerCheck);
  const evidence = EVIDENCE_STACK_MONTHLY_USD_APPROX;
  // Charged on the first recording sweep, not spread across the month.
  const initial = cents(shape.resourceCount * CONFIG_ITEMS_PER_RESOURCE_INITIAL * prices.configPerItem);

  const items: CostLineItem[] = [
    {
      service: "config",
      monthlyUsd: config,
      detail: `≈${configItems.toLocaleString("en-US")} recorded changes + ${ruleEvals.toLocaleString("en-US")} rule evaluations / month, from ${shape.resourceCount.toLocaleString("en-US")} resources found in your account`,
      source: prices.source,
    },
    {
      service: "securityhub",
      monthlyUsd: securityhub,
      detail: `≈${checks.toLocaleString("en-US")} security checks / month across ${shape.enabledControls} controls`,
      source: prices.source,
    },
    {
      service: "evidence",
      monthlyUsd: evidence,
      detail: "your evidence bucket + one snapshot run a month",
      source: "approx",
    },
  ];
  return {
    items,
    totalMonthlyUsd: cents(config + securityhub + evidence),
    initialUsd: initial,
    source: prices.source,
  };
}

export interface FreeTrialState {
  /** ISO date (yyyy-mm-dd) the trial ends. */
  endsOn: string;
  daysLeft: number;
  expired: boolean;
}

export const SECURITY_HUB_TRIAL_DAYS = 30;

/** Security Hub's 30-day free trial, from the moment WE enabled it. */
export function freeTrial(enabledAt: string, now: Date, trialDays = SECURITY_HUB_TRIAL_DAYS): FreeTrialState | undefined {
  const start = Date.parse(enabledAt);
  if (!Number.isFinite(start)) return undefined;
  const end = new Date(start + trialDays * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return {
    endsOn: end.toISOString().slice(0, 10),
    daysLeft: Math.max(0, daysLeft),
    expired: daysLeft <= 0,
  };
}
