import { multiplyByBps } from "./money.js";
import { matchPolicy, type PublishedPolicy, type ValidatedCalculationInput } from "./policy.js";

export type TraceCode =
  | "class_b_advance_payment"
  | "deductible"
  | "reimbursable_base"
  | "applied_rate"
  | "theoretical_basic_reimbursement"
  | "remaining_annual_cap"
  | "basic_reimbursement"
  | "catastrophic_reimbursement"
  | "estimated_self_pay";

export interface CalculationTraceStep {
  readonly code: TraceCode;
  readonly label: string;
  readonly valueFen?: number;
  readonly valueBps?: number;
  readonly note?: string;
}

export interface CalculationResult {
  readonly classBAdvancePaymentFen: number;
  readonly deductibleFen: number;
  readonly reimbursableBaseFen: number;
  readonly appliedRateBps: number;
  readonly theoreticalBasicReimbursementFen: number;
  readonly remainingAnnualCapFen: number;
  readonly basicReimbursementFen: number;
  readonly catastrophicReimbursementFen: number;
  readonly estimatedSelfPayFen: number;
  readonly trace: readonly CalculationTraceStep[];
}

function assertNonNegativeInteger(value: number, fieldLabel: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldLabel}必须是非负整数分`);
  }
}

function calculateCatastrophicReimbursement(overCapFen: number, policy: PublishedPolicy): number {
  let remainingFen = overCapFen;
  let lowerBoundFen = 0;
  let reimbursementFen = 0;

  for (const tier of policy.catastrophicTiers) {
    if (remainingFen === 0) break;

    const tierWidthFen = tier.upperBoundFen === null
      ? remainingFen
      : Math.max(0, Math.min(remainingFen, tier.upperBoundFen - lowerBoundFen));

    reimbursementFen += multiplyByBps(tierWidthFen, tier.reimbursementRateBps);
    remainingFen -= tierWidthFen;
    if (tier.upperBoundFen !== null) lowerBoundFen = tier.upperBoundFen;
  }

  return reimbursementFen;
}

export class ReimbursementEngine {
  calculate(policy: PublishedPolicy, input: ValidatedCalculationInput): CalculationResult {
    for (const [value, label] of [
      [input.totalAmountFen, "总费用"],
      [input.outOfCatalogAmountFen, "目录外费用"],
      [input.classBAmountFen, "乙类费用"],
      [input.annualReimbursedAmountFen, "年度已报销累计"],
    ] as const) {
      assertNonNegativeInteger(value, label);
    }

    if (input.outOfCatalogAmountFen > input.totalAmountFen || input.classBAmountFen > input.totalAmountFen) {
      throw new Error("目录外费用和乙类费用不能大于总费用");
    }

    const matched = matchPolicy(policy, input);
    const classBAdvancePaymentFen = multiplyByBps(input.classBAmountFen, policy.classBAdvanceRateBps);
    const deductibleFen = matched.hospitalRule.deductibleFen;
    const reimbursableBaseFen = Math.max(
      0,
      input.totalAmountFen - input.outOfCatalogAmountFen - classBAdvancePaymentFen - deductibleFen,
    );
    const appliedRateBps = Math.max(
      0,
      matched.hospitalRule.reimbursementRateBps + matched.retirementBonusBps - matched.outOfAreaReductionBps,
    );
    const theoreticalBasicReimbursementFen = multiplyByBps(reimbursableBaseFen, appliedRateBps);
    const remainingAnnualCapFen = Math.max(0, policy.annualCapFen - input.annualReimbursedAmountFen);
    const basicReimbursementFen = Math.min(theoreticalBasicReimbursementFen, remainingAnnualCapFen);
    const overCapFen = Math.max(0, theoreticalBasicReimbursementFen - remainingAnnualCapFen);
    const catastrophicReimbursementFen = policy.catastrophicTiers.length === 0
      ? 0
      : calculateCatastrophicReimbursement(overCapFen, policy);
    const estimatedSelfPayFen = Math.max(
      0,
      input.totalAmountFen - basicReimbursementFen - catastrophicReimbursementFen,
    );

    const trace: CalculationTraceStep[] = [
      { code: "class_b_advance_payment", label: "乙类先行自付", valueFen: classBAdvancePaymentFen },
      { code: "deductible", label: "住院起付线", valueFen: deductibleFen },
      { code: "reimbursable_base", label: "可报销基数", valueFen: reimbursableBaseFen },
      { code: "applied_rate", label: "实际报销比例", valueBps: appliedRateBps },
      { code: "theoretical_basic_reimbursement", label: "理论基本医保报销", valueFen: theoreticalBasicReimbursementFen },
      { code: "remaining_annual_cap", label: "剩余年度封顶额度", valueFen: remainingAnnualCapFen },
      { code: "basic_reimbursement", label: "基本医保报销", valueFen: basicReimbursementFen },
      {
        code: "catastrophic_reimbursement",
        label: "大病保险报销",
        valueFen: catastrophicReimbursementFen,
        note: policy.catastrophicTiers.length === 0 ? "当前示例政策未配置大病保险阶梯" : undefined,
      },
      { code: "estimated_self_pay", label: "预计自费", valueFen: estimatedSelfPayFen },
    ];

    return {
      classBAdvancePaymentFen,
      deductibleFen,
      reimbursableBaseFen,
      appliedRateBps,
      theoreticalBasicReimbursementFen,
      remainingAnnualCapFen,
      basicReimbursementFen,
      catastrophicReimbursementFen,
      estimatedSelfPayFen,
      trace,
    };
  }
}
