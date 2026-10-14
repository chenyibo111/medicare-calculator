import type { PublishedPolicy } from "../../../packages/domain/src/policy";

export const offlinePolicies: Record<string, PublishedPolicy> = {
  城市A: {
    region: "城市A", benefitPlan: "职工医保", version: "A-2026.01", effectiveFrom: "2026-01-01", sourceReference: "示例城市 A 医保政策",
    hospitalRules: { community: { deductibleFen: 20_000, reimbursementRateBps: 9000 }, secondary: { deductibleFen: 40_000, reimbursementRateBps: 8500 }, tertiary: { deductibleFen: 80_000, reimbursementRateBps: 8000 } },
    classBAdvanceRateBps: 1000, annualCapFen: 40_000_000, retirementBonusBps: 500, unfiledOutOfAreaReductionBps: 2000,
    catastrophicTiers: [{ upperBoundFen: 5_000_000, reimbursementRateBps: 6000 }, { upperBoundFen: 10_000_000, reimbursementRateBps: 6500 }, { upperBoundFen: null, reimbursementRateBps: 7000 }],
  },
  城市B: {
    region: "城市B", benefitPlan: "居民医保", version: "B-2026.01", effectiveFrom: "2026-01-01", sourceReference: "示例城市 B 医保政策",
    hospitalRules: { community: { deductibleFen: 10_000, reimbursementRateBps: 8500 }, secondary: { deductibleFen: 30_000, reimbursementRateBps: 7500 }, tertiary: { deductibleFen: 60_000, reimbursementRateBps: 6500 } },
    classBAdvanceRateBps: 1500, annualCapFen: 20_000_000, retirementBonusBps: 0, unfiledOutOfAreaReductionBps: 1500, catastrophicTiers: [],
  },
};
