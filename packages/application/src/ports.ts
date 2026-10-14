import type { CalculationCriteria } from "../../contracts/src/calculation-contract.js";
import type { PublishedPolicy } from "../../domain/src/policy.js";

export interface PolicyRepository {
  findPublished(criteria: CalculationCriteria): Promise<PublishedPolicy | null>;
}

export interface PolicyCache {
  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<{ value: T; status: "hit" | "miss" }>;
  invalidateByPolicyVersion(version: string): Promise<void>;
}

export interface AuditLog {
  append(event: {
    readonly calculationId: string;
    readonly region: string;
    readonly policyVersion: string;
    readonly cacheStatus: "hit" | "miss";
    readonly createdAt: string;
  }): Promise<void>;
}
