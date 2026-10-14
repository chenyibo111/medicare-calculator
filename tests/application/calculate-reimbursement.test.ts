import { describe, expect, it } from "vitest";
import { CalculateReimbursementUseCase, CalculationApplicationError } from "../../packages/application/src/calculate-reimbursement.js";
import type { AuditLog, PolicyCache, PolicyRepository } from "../../packages/application/src/ports.js";
import type { PublishedPolicy } from "../../packages/domain/src/policy.js";

const cityBPolicy: PublishedPolicy = {
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
};

function createDependencies(policy: PublishedPolicy | null = cityBPolicy) {
  const repository: PolicyRepository & { calls: number } = {
    calls: 0,
    async findPublished() {
      this.calls += 1;
      return policy;
    },
  };
  const cache: PolicyCache = {
    async getOrLoad(_key, loader) {
      return { value: await loader(), status: "miss" };
    },
    async invalidateByPolicyVersion() {},
  };
  const events: unknown[] = [];
  const auditLog: AuditLog = {
    async append(event) {
      events.push(event);
    },
  };

  return { repository, cache, auditLog, events };
}

const validRequest = {
  region: "城市B",
  hospitalLevel: "tertiary",
  employmentStatus: "resident",
  totalAmountFen: 6_000_000,
  outOfCatalogAmountFen: 200_000,
  classBAmountFen: 1_000_000,
  annualReimbursedAmountFen: 0,
  outOfAreaFiled: true,
};

describe("CalculateReimbursementUseCase", () => {
  it.each([
    [{ ...validRequest, totalAmountFen: -1 }, "总医疗费用必须是非负整数分"],
    [{ ...validRequest, outOfCatalogAmountFen: 6_000_001 }, "目录外费用不能大于总医疗费用"],
    [{ ...validRequest, classBAmountFen: 6_000_001 }, "乙类费用不能大于总医疗费用"],
    [{ ...validRequest, totalAmountFen: "6000000" }, "总医疗费用必须是非负整数分"],
    [{ ...validRequest, employmentStatus: "retired" }, "城市B 仅支持居民医保身份"],
  ])("rejects invalid request %o with a recoverable Chinese error", async (request, message) => {
    const dependencies = createDependencies();
    const useCase = new CalculateReimbursementUseCase(dependencies);

    await expect(useCase.execute(request, { requestId: "test-invalid" })).rejects.toMatchObject({
      name: "CalculationApplicationError",
      message,
      code: "VALIDATION_ERROR",
    });
    expect(dependencies.repository.calls).toBe(0);
  });

  it("returns policy version, cache state, calculation trace and audit event for a valid request", async () => {
    const dependencies = createDependencies();
    const useCase = new CalculateReimbursementUseCase(dependencies);

    const response = await useCase.execute(validRequest, {
      requestId: "calculation-123",
      calculationDate: "2026-10-14",
    });

    expect(response.calculationId).toBe("calculation-123");
    expect(response.policyVersion).toBe("B-2026.01");
    expect(response.cacheStatus).toBe("miss");
    expect(response.result.estimatedSelfPayFen).toBe(2_366_500);
    expect(response.trace).toHaveLength(9);
    expect(dependencies.events).toHaveLength(1);
  });

  it("returns a policy-not-found error instead of guessing a result for an unknown region", async () => {
    const dependencies = createDependencies(null);
    const useCase = new CalculateReimbursementUseCase(dependencies);

    await expect(useCase.execute({ ...validRequest, region: "未知城市" }, { requestId: "unknown" })).rejects.toEqual(
      new CalculationApplicationError("POLICY_NOT_FOUND", "未找到可用的已发布政策"),
    );
  });
});
