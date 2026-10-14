export type HospitalLevel = "community" | "secondary" | "tertiary";
export type EmploymentStatus = "employed" | "retired" | "resident";

export interface HospitalRule {
  readonly deductibleFen: number;
  readonly reimbursementRateBps: number;
}

export interface CatastrophicTier {
  readonly upperBoundFen: number | null;
  readonly reimbursementRateBps: number;
}

export interface PublishedPolicy {
  readonly region: string;
  readonly benefitPlan: "职工医保" | "居民医保";
  readonly version: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly sourceReference: string;
  readonly hospitalRules: Readonly<Record<HospitalLevel, HospitalRule>>;
  readonly classBAdvanceRateBps: number;
  readonly annualCapFen: number;
  readonly retirementBonusBps: number;
  readonly unfiledOutOfAreaReductionBps: number;
  readonly catastrophicTiers: readonly CatastrophicTier[];
}

export interface ValidatedCalculationInput {
  readonly region: string;
  readonly hospitalLevel: HospitalLevel;
  readonly employmentStatus: EmploymentStatus;
  readonly totalAmountFen: number;
  readonly outOfCatalogAmountFen: number;
  readonly classBAmountFen: number;
  readonly annualReimbursedAmountFen: number;
  readonly outOfAreaFiled: boolean;
}

export interface MatchedRuleSet {
  readonly hospitalRule: HospitalRule;
  readonly retirementBonusBps: number;
  readonly outOfAreaReductionBps: number;
}

export function matchPolicy(policy: PublishedPolicy, input: ValidatedCalculationInput): MatchedRuleSet {
  if (policy.region !== input.region) {
    throw new Error("未找到匹配的统筹地区政策");
  }

  const isEmployeePlan = policy.benefitPlan === "职工医保";
  if (isEmployeePlan && input.employmentStatus === "resident") {
    throw new Error("职工医保政策不适用于居民身份");
  }
  if (!isEmployeePlan && input.employmentStatus !== "resident") {
    throw new Error("居民医保政策不适用于在职或退休身份");
  }

  return {
    hospitalRule: policy.hospitalRules[input.hospitalLevel],
    retirementBonusBps: input.employmentStatus === "retired" ? policy.retirementBonusBps : 0,
    outOfAreaReductionBps: input.outOfAreaFiled ? 0 : policy.unfiledOutOfAreaReductionBps,
  };
}
