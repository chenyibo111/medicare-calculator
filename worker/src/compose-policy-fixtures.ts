import type { CalculationRequest } from "../../packages/contracts/src/calculation-contract.js";
import type { PublishedPolicy } from "../../packages/domain/src/policy.js";

export type ComposeAcceptancePolicyVersion = "v1" | "v2";

export const COMPOSE_ACCEPTANCE_REGION = "Compose验收市";
export const COMPOSE_ACCEPTANCE_BENEFIT_PLAN = "居民医保" as const;
export const COMPOSE_ACCEPTANCE_EFFECTIVE_FROM = "2026-01-01";

export const COMPOSE_ACCEPTANCE_CALCULATION_REQUEST: CalculationRequest = {
  region: COMPOSE_ACCEPTANCE_REGION,
  hospitalLevel: "tertiary",
  employmentStatus: "resident",
  totalAmountFen: 2_000_000,
  outOfCatalogAmountFen: 100_000,
  classBAmountFen: 200_000,
  annualReimbursedAmountFen: 0,
  outOfAreaFiled: true,
};

export function composeAcceptancePolicy(version: ComposeAcceptancePolicyVersion): PublishedPolicy {
  return {
    region: COMPOSE_ACCEPTANCE_REGION,
    benefitPlan: COMPOSE_ACCEPTANCE_BENEFIT_PLAN,
    version: `compose-e2e-${version}`,
    effectiveFrom: COMPOSE_ACCEPTANCE_EFFECTIVE_FROM,
    sourceReference: `Compose 验收政策 ${version}`,
    hospitalRules: {
      community: { deductibleFen: 20_000, reimbursementRateBps: version === "v1" ? 7_000 : 8_000 },
      secondary: { deductibleFen: 50_000, reimbursementRateBps: version === "v1" ? 6_500 : 7_500 },
      tertiary: { deductibleFen: 80_000, reimbursementRateBps: version === "v1" ? 6_000 : 7_000 },
    },
    classBAdvanceRateBps: 0,
    annualCapFen: 5_000_000,
    retirementBonusBps: 0,
    unfiledOutOfAreaReductionBps: 0,
    catastrophicTiers: [],
  };
}
