import { describe, expect, it } from "vitest";
import { formatFen, multiplyByBps, yuanToFen } from "../../packages/domain/src/money.js";
import { ReimbursementEngine } from "../../packages/domain/src/reimbursement-engine.js";

const cityA = {
  region: "城市A",
  benefitPlan: "职工医保",
  version: "A-2026.01",
  effectiveFrom: "2026-01-01",
  sourceReference: "示例城市 A 医保政策",
  hospitalRules: {
    community: { deductibleFen: 20_000, reimbursementRateBps: 9_000 },
    secondary: { deductibleFen: 40_000, reimbursementRateBps: 8_500 },
    tertiary: { deductibleFen: 80_000, reimbursementRateBps: 8_000 },
  },
  classBAdvanceRateBps: 1_000,
  annualCapFen: 40_000_000,
  retirementBonusBps: 500,
  unfiledOutOfAreaReductionBps: 2_000,
  catastrophicTiers: [
    { upperBoundFen: 5_000_000, reimbursementRateBps: 6_000 },
    { upperBoundFen: 10_000_000, reimbursementRateBps: 6_500 },
    { upperBoundFen: null, reimbursementRateBps: 7_000 },
  ],
} as const;

const cityB = {
  region: "城市B",
  benefitPlan: "居民医保",
  version: "B-2026.01",
  effectiveFrom: "2026-01-01",
  sourceReference: "示例城市 B 医保政策",
  hospitalRules: {
    community: { deductibleFen: 10_000, reimbursementRateBps: 8_500 },
    secondary: { deductibleFen: 30_000, reimbursementRateBps: 7_500 },
    tertiary: { deductibleFen: 60_000, reimbursementRateBps: 6_500 },
  },
  classBAdvanceRateBps: 1_500,
  annualCapFen: 20_000_000,
  retirementBonusBps: 0,
  unfiledOutOfAreaReductionBps: 1_500,
  catastrophicTiers: [],
} as const;

describe("money helpers", () => {
  it("converts decimal yuan strings to integer fen without floating-point drift", () => {
    expect(yuanToFen("123.45")).toBe(12_345);
    expect(formatFen(12_345)).toBe("¥123.45");
  });

  it("uses exact integer arithmetic for safe-integer amounts and basis points", () => {
    expect(multiplyByBps(9_007_199_254_660_991, 8_000)).toBe(7_205_759_403_728_792);
  });
});

describe("ReimbursementEngine", () => {
  const engine = new ReimbursementEngine();

  it("calculates a tertiary employed city A stay with every basic deduction in the trace", () => {
    const result = engine.calculate(cityA, {
      region: "城市A",
      hospitalLevel: "tertiary",
      employmentStatus: "employed",
      totalAmountFen: 10_000_000,
      outOfCatalogAmountFen: 100_000,
      classBAmountFen: 500_000,
      annualReimbursedAmountFen: 0,
      outOfAreaFiled: true,
    });

    expect(result.classBAdvancePaymentFen).toBe(50_000);
    expect(result.reimbursableBaseFen).toBe(9_770_000);
    expect(result.appliedRateBps).toBe(8_000);
    expect(result.basicReimbursementFen).toBe(7_816_000);
    expect(result.catastrophicReimbursementFen).toBe(0);
    expect(result.estimatedSelfPayFen).toBe(2_184_000);
    expect(result.trace.map((step) => step.code)).toEqual([
      "class_b_advance_payment",
      "deductible",
      "reimbursable_base",
      "applied_rate",
      "theoretical_basic_reimbursement",
      "remaining_annual_cap",
      "basic_reimbursement",
      "catastrophic_reimbursement",
      "estimated_self_pay",
    ]);
    expect(Object.values(result).filter((value) => typeof value === "number").every(Number.isInteger)).toBe(true);
  });

  it("adds five percentage points for a retired city A member", () => {
    const result = engine.calculate(cityA, {
      region: "城市A",
      hospitalLevel: "tertiary",
      employmentStatus: "retired",
      totalAmountFen: 10_000_000,
      outOfCatalogAmountFen: 100_000,
      classBAmountFen: 500_000,
      annualReimbursedAmountFen: 0,
      outOfAreaFiled: true,
    });

    expect(result.appliedRateBps).toBe(8_500);
    expect(result.basicReimbursementFen).toBe(8_304_500);
    expect(result.estimatedSelfPayFen).toBe(1_695_500);
  });

  it("reduces the city A rate by twenty percentage points when out-of-area filing is absent", () => {
    const result = engine.calculate(cityA, {
      region: "城市A",
      hospitalLevel: "tertiary",
      employmentStatus: "employed",
      totalAmountFen: 10_000_000,
      outOfCatalogAmountFen: 100_000,
      classBAmountFen: 500_000,
      annualReimbursedAmountFen: 0,
      outOfAreaFiled: false,
    });

    expect(result.appliedRateBps).toBe(6_000);
    expect(result.basicReimbursementFen).toBe(5_862_000);
    expect(result.estimatedSelfPayFen).toBe(4_138_000);
  });

  it("calculates city B without inventing a catastrophic policy", () => {
    const result = engine.calculate(cityB, {
      region: "城市B",
      hospitalLevel: "tertiary",
      employmentStatus: "resident",
      totalAmountFen: 6_000_000,
      outOfCatalogAmountFen: 200_000,
      classBAmountFen: 1_000_000,
      annualReimbursedAmountFen: 0,
      outOfAreaFiled: true,
    });

    expect(result.classBAdvancePaymentFen).toBe(150_000);
    expect(result.reimbursableBaseFen).toBe(5_590_000);
    expect(result.basicReimbursementFen).toBe(3_633_500);
    expect(result.catastrophicReimbursementFen).toBe(0);
    expect(result.estimatedSelfPayFen).toBe(2_366_500);
    expect(result.trace.find((step) => step.code === "catastrophic_reimbursement")?.note).toContain("未配置");
  });

  it("applies all city A catastrophic reimbursement tiers after the annual cap", () => {
    const result = engine.calculate(cityA, {
      region: "城市A",
      hospitalLevel: "tertiary",
      employmentStatus: "employed",
      totalAmountFen: 15_080_000,
      outOfCatalogAmountFen: 0,
      classBAmountFen: 0,
      annualReimbursedAmountFen: 39_000_000,
      outOfAreaFiled: true,
    });

    expect(result.reimbursableBaseFen).toBe(15_000_000);
    expect(result.theoreticalBasicReimbursementFen).toBe(12_000_000);
    expect(result.basicReimbursementFen).toBe(1_000_000);
    expect(result.catastrophicReimbursementFen).toBe(6_950_000);
    expect(result.estimatedSelfPayFen).toBe(7_130_000);
  });

  it("never increases basic reimbursement after the annual cap has already been consumed", () => {
    const beforeCap = engine.calculate(cityB, {
      region: "城市B",
      hospitalLevel: "community",
      employmentStatus: "resident",
      totalAmountFen: 1_000_000,
      outOfCatalogAmountFen: 0,
      classBAmountFen: 0,
      annualReimbursedAmountFen: 19_000_000,
      outOfAreaFiled: true,
    });
    const afterCap = engine.calculate(cityB, {
      region: "城市B",
      hospitalLevel: "community",
      employmentStatus: "resident",
      totalAmountFen: 1_000_000,
      outOfCatalogAmountFen: 0,
      classBAmountFen: 0,
      annualReimbursedAmountFen: 20_000_000,
      outOfAreaFiled: true,
    });

    expect(afterCap.basicReimbursementFen).toBe(0);
    expect(afterCap.basicReimbursementFen).toBeLessThanOrEqual(beforeCap.basicReimbursementFen);
    expect(afterCap.estimatedSelfPayFen).toBe(1_000_000);
  });
});
