import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CalculateReimbursementUseCase } from "../../../packages/application/src/calculate-reimbursement.js";
import { FilePolicyRepository } from "../../../packages/infrastructure/src/file-policy-repository.js";
import { InMemoryAuditLog } from "../../../packages/infrastructure/src/in-memory-audit-log.js";
import { TtlPolicyCache } from "../../../packages/infrastructure/src/ttl-policy-cache.js";

export function createTestCalculationUseCase(): CalculateReimbursementUseCase {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return new CalculateReimbursementUseCase({
    repository: new FilePolicyRepository(resolve(root, "data/published-policies")),
    cache: new TtlPolicyCache({ ttlMs: 5 * 60_000 }),
    auditLog: new InMemoryAuditLog(),
  });
}
