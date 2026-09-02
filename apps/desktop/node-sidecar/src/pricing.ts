/**
 * Live unit prices from the AWS Price List API (AGENTS.md §9 "show the money":
 * never hardcoded). Best-effort by design: when the live lookup can't produce
 * a number, the caller falls back to core's APPROX_UNIT_PRICES and the UI
 * labels every figure "approx" — degrade honestly, never silently.
 *
 * Cached per process session; the Price List API is free but not fast.
 */
import { GetProductsCommand } from "@aws-sdk/client-pricing";
import { APPROX_UNIT_PRICES, type UnitPrices } from "@auditpoppy/core";
import type { Clients } from "./clients";

interface GetProductsOutput {
  PriceList?: string[];
  NextToken?: string;
}

interface PriceDimension {
  description?: string;
  pricePerUnit?: { USD?: string };
  beginRange?: string;
}

/** Walk a price-list item's terms for its on-demand dimensions. */
function dimensionsOf(item: unknown): PriceDimension[] {
  const out: PriceDimension[] = [];
  const terms = (item as { terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, PriceDimension> }> } })
    .terms?.OnDemand;
  for (const term of Object.values(terms ?? {})) {
    out.push(...Object.values(term.priceDimensions ?? {}));
  }
  return out;
}

async function firstTierUsd(
  clients: Clients,
  serviceCode: string,
  region: string,
  match: RegExp,
): Promise<number | undefined> {
  const res = (await clients.pricing.send(
    new GetProductsCommand({
      ServiceCode: serviceCode,
      Filters: [{ Type: "TERM_MATCH", Field: "regionCode", Value: region }],
      MaxResults: 100,
    }),
  )) as GetProductsOutput;
  const candidates: number[] = [];
  for (const raw of res.PriceList ?? []) {
    let item: unknown;
    try {
      item = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const dim of dimensionsOf(item)) {
      if (!dim.description || !match.test(dim.description)) continue;
      // First tier only (beginRange 0 when present).
      if (dim.beginRange !== undefined && dim.beginRange !== "0") continue;
      const usd = Number(dim.pricePerUnit?.USD);
      if (Number.isFinite(usd) && usd > 0) candidates.push(usd);
    }
  }
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

let cached: UnitPrices | null = null;

export async function fetchUnitPrices(clients: Clients): Promise<UnitPrices> {
  if (cached) return cached;
  try {
    const [configItem, ruleEval, hubCheck] = await Promise.all([
      firstTierUsd(clients, "AWSConfig", clients.region, /configuration item/i),
      firstTierUsd(clients, "AWSConfig", clients.region, /rule evaluation/i),
      firstTierUsd(clients, "AWSSecurityHub", clients.region, /security check/i),
    ]);
    if (configItem !== undefined && hubCheck !== undefined) {
      cached = {
        configPerItem: configItem,
        configPerRuleEvaluation: ruleEval ?? APPROX_UNIT_PRICES.configPerRuleEvaluation,
        securityHubPerCheck: hubCheck,
        source: "live",
        currency: "USD",
      };
      return cached;
    }
  } catch {
    /* fall through to the honest approx */
  }
  return APPROX_UNIT_PRICES;
}

/** Test seam. */
export function __resetPricingCacheForTests(): void {
  cached = null;
}
