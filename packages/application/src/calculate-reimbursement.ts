import { randomUUID } from "node:crypto";
import {
  type CalculationRequest,
  type CalculationResponse,
  type RequestContext,
  parseCalculationRequest,
} from "../../contracts/src/calculation-contract.js";
import { ReimbursementEngine } from "../../domain/src/reimbursement-engine.js";
import type { AuditLog, PolicyCache, PolicyRepository } from "./ports.js";

export class CalculationApplicationError extends Error {
  constructor(readonly code: "VALIDATION_ERROR" | "POLICY_NOT_FOUND", message: string) {
    super(message);
    this.name = "CalculationApplicationError";
  }
}

export class CalculateReimbursementUseCase {
  private readonly engine = new ReimbursementEngine();

  constructor(private readonly dependencies: { repository: PolicyRepository; cache: PolicyCache; auditLog: AuditLog }) {}

  async execute(rawRequest: unknown, context: RequestContext): Promise<CalculationResponse> {
    let request: CalculationRequest;
    try {
      request = parseCalculationRequest(rawRequest);
    } catch (error) {
      if (error instanceof Error) throw new CalculationApplicationError("VALIDATION_ERROR", error.message);
      throw error;
    }

    const calculationDate = context.calculationDate ?? new Date().toISOString().slice(0, 10);
    const criteria = {
      region: request.region,
      hospitalLevel: request.hospitalLevel,
      employmentStatus: request.employmentStatus,
      calculationDate,
    };
    const provisionalKey = `${criteria.region}:${criteria.employmentStatus}:${calculationDate}`;
    const cached = await this.dependencies.cache.getOrLoad(provisionalKey, async () => {
      const policy = await this.dependencies.repository.findPublished(criteria);
      if (policy === null) throw new CalculationApplicationError("POLICY_NOT_FOUND", "未找到可用的已发布政策");
      return policy;
    });
    const result = this.engine.calculate(cached.value, request);
    const calculationId = context.requestId ?? randomUUID();

    await this.dependencies.auditLog.append({
      calculationId,
      region: request.region,
      policyVersion: cached.value.version,
      cacheStatus: cached.status,
      createdAt: new Date().toISOString(),
    });

    return {
      calculationId,
      policyVersion: cached.value.version,
      cacheStatus: cached.status,
      result,
      trace: result.trace,
    };
  }
}
